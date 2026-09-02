/**
 * Project actions (SPEC PROJ-1/PROJ-2 via TECH-13). The authorize hooks
 * enforce ownership (P-4) — the first real use of the action pipeline.
 * project.delete cascades through decks, slides, and seed material.
 */
import { z } from 'zod'
import { LOCALES } from '@slide-machine/shared'
import type {
  DeckShare,
  Project,
  ProjectCreateInput,
  ProjectDeleteInput,
  ProjectReorderLecturesInput,
  ProjectSetAccessInput,
  ProjectShareInput,
  ProjectSharesInput,
  ProjectSwitchTemplateInput,
  ProjectTransferOwnershipInput,
  ProjectUnshareInput,
  ProjectUpdateInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import {
  ProjectModel,
  projectAcl,
  toProjectDto,
  toSharedProjectDto,
  type ProjectDb,
} from '../models/project'
import { UserModel } from '../models/user'
import { emailVerified, requireVerifiedEmail } from '../auth/verified'
import { canEditAcl, canViewAcl, isAclMember } from '../lib/access'
import {
  adminViewer,
  isAllowlistedAdmin,
  logDeletedView,
  withDeleted,
  type AdminViewer,
} from '../lib/admin-view'
import { withProjectSettingsAudit } from '../lib/admin-edit'
import {
  custom,
  projectOwner,
  projectSettings,
  projectSettingsView,
  signedIn,
  type ProjectAccess,
  type Signed,
  type ProjectSettingsAccess,
} from './access'
import { recordSettingsChange } from '../audit/settings-log'
import { projectSettingsSnapshot } from '../lib/settings-snapshot'
import { ttsVoiceIdSchema } from '../lib/tts-voice'
import { sharesOfAcl } from '../lib/shares'
import { templateExists } from '../templates/resolve'
import type { HydratedDocument, Types } from 'mongoose'
import { DeckModel, loadDeckAcls } from '../models/deck'
import { deleteProjectCascade } from '../lib/cascade'
import { orderByLectureOrder } from '../lib/lecture-order'

/** The settings gate: an owner or editor, otherwise an allowlisted admin
 * overriding the ACL, whose edit is then audited (ADMIN-5). */
const settingsOf = projectSettings(
  (input: { projectId: string }) => input.projectId,
)

/** Owner-only, unlike the rest of access management. */
/** The same admission, for an action that only reads the settings. */
const settingsReadOf = projectSettingsView(
  (input: { projectId: string }) => input.projectId,
)

const ownerOf = projectOwner((input: { projectId: string }) => input.projectId)

/** Returns the acting user's id or throws; actions requiring auth start here. */
const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/**
 * Every action that changes a project's settings runs its work inside
 * editProjectSettings (lib/admin-edit.ts): it loads a project the acting
 * user may edit — an owner or editor as usual, or an allowlisted admin
 * editing someone else's project from the ordinary settings modal, whose
 * changes it audits (ADMIN-5). Ownership transfer and deletion stay
 * owner-only and check for themselves.
 */

export const projectCreate = defineAction<ProjectCreateInput, Project, Signed>({
  name: 'project.create',
  access: signedIn(),
  input: z.object({
    // Blank is allowed: a titleless project is the "default" one created
    // for a user's first lecture; the client shows a placeholder name.
    title: z.string().trim().default(''),
    course: z.string().optional(),
    description: z.string().optional(),
    seedContext: z.string().optional(),
  }),
  execute: async (ctx, input) => {
    const ownerId = requireUser(ctx)
    // Projects are public by default, and one thing overrides that: an
    // unconfirmed address (AUTH-3), because publishing on behalf of an
    // account nobody has proved they own is publishing without ever being
    // asked. Confirming the address lets them open it up.
    const restricted = !(await emailVerified(ownerId))
    // The owner's account default is the creation-time design (TMPL-24); the
    // project stores its own copy and can switch independently afterwards,
    // exactly as a lecture does with its project's. A stale choice — a
    // template since deleted — is dropped rather than inherited, so the model
    // default (the deployment's template) applies instead.
    const owner = await UserModel.findById(ownerId).catch(() => null)
    const templateId =
      owner?.templateId && (await templateExists(owner.templateId))
        ? owner.templateId
        : undefined
    const doc = await ProjectModel.create({
      ...input,
      ownerId,
      ...(templateId ? { templateId } : {}),
      ...(restricted ? { visibility: 'restricted' } : {}),
    })
    return toProjectDto(doc)
  },
})

export const projectList = defineAction<
  Record<string, never>,
  Project[],
  Signed
>({
  name: 'project.list',
  access: signedIn(),
  input: z.object({}),
  execute: async ctx => {
    const docs = await ProjectModel.find({ ownerId: requireUser(ctx) })
    // A project is "modified" when its own settings change OR when any deck
    // inside it changes; rank by whichever happened most recently. The newest
    // deck edit per project (across all decks, not just the caller's) comes
    // from a single grouped query.
    const rows = await DeckModel.aggregate<{
      _id: Types.ObjectId
      updatedAt: Date
    }>([
      { $match: { projectId: { $in: docs.map(d => d._id) } } },
      { $group: { _id: '$projectId', updatedAt: { $max: '$updatedAt' } } },
    ])
    const latestDeckEdit = new Map(
      rows.map(r => [r._id.toString(), r.updatedAt.getTime()]),
    )
    const modifiedAt = (doc: HydratedDocument<ProjectDb>) =>
      Math.max(
        (doc.updatedAt ?? doc.createdAt).getTime(),
        latestDeckEdit.get(doc._id.toString()) ?? 0,
      )
    return docs.sort((a, b) => modifiedAt(b) - modifiedAt(a)).map(toProjectDto)
  },
})

/**
 * The project an id names for a reader: the live one, or — for an
 * allowlisted admin alone — a soft-deleted one, which is refused to
 * everyone else (ADMIN-6). Returns the admin a tombstone was opened for, so
 * the caller can audit what the bypass exposed; null whenever the project is
 * live. Throws when there is nothing to read either way.
 */
const loadReadableProject = async (
  projectId: string,
  userId: string,
): Promise<{
  doc: HydratedDocument<ProjectDb>
  deletedFor: AdminViewer | null
}> => {
  const live = await ProjectModel.findById(projectId).catch(() => null)
  if (live) return { doc: live, deletedFor: null }
  const deletedFor = await adminViewer(userId)
  if (!deletedFor) throw new ActionForbiddenError()
  const doc = await ProjectModel.findById(projectId)
    .setOptions(withDeleted)
    .catch(() => null)
  if (!doc) throw new ActionForbiddenError()
  return { doc, deletedFor }
}

export const projectGet = defineAction<{ projectId: string }, Project, Signed>({
  name: 'project.get',
  // Admission and response shape are one decision here: a member reads the
  // project in full, an allowlisted admin does too (and a TOMBSTONED one,
  // whose opening is audited — ADMIN-6), a stranger reads a public project
  // in its shareable shape with prep notes and people lists stripped, and
  // anyone else is refused. No single level says 'readable, at one of
  // several fidelities'.
  access: custom(
    'admission and response fidelity are the same decision — member, admin and public reader each get a different shape, and opening a deleted project is audited (ADMIN-6)',
  ),
  input: z.object({ projectId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const { doc, deletedFor } = await loadReadableProject(
      input.projectId,
      userId,
    )
    const acl = projectAcl(doc)
    // Opening a tombstoned project is audited, one entry per opening — the
    // same treatment an admin's view of private content gets.
    if (doc.deletedAt && deletedFor) {
      await logDeletedView(
        deletedFor,
        'project.deleted_view',
        'project',
        doc._id.toString(),
        {
          title: doc.title,
          ownerId: doc.ownerId.toString(),
          deletedAt: doc.deletedAt.toISOString(),
        },
      )
    }
    /** Names the owner on the page, linking to their profile (SOC-4). Every
     * reader of a project gets it: it says whose work this is, which is not
     * privileged the way seed notes and people lists are. */
    const withOwner = async (dto: Project): Promise<Project> => {
      // A tombstoned project usually went down with its owner's account, so
      // the name still resolves for the admin reading it (ADMIN-6).
      const owner = await UserModel.findById(dto.ownerId)
        .setOptions(doc.deletedAt ? withDeleted : {})
        .catch(() => null)
      if (!owner) return dto
      return { ...dto, owner: { id: owner.id, displayName: owner.displayName } }
    }
    // Non-members: allowlisted admins get an always-on bypass, mirroring the
    // lecture-viewer one (lib/admin-view.ts). They read the full project, seed
    // notes and people lists included: the console already surfaces both, and
    // the settings modal they edit from reads them (ADMIN-5). Everyone else may
    // read a PUBLIC project (SOC discovery) — but only its shareable shape: the
    // people lists and prep notes are stripped, and deck.list still hides its
    // non-public lectures. A restricted project stays members-only (404).
    if (!isAclMember(acl, userId)) {
      if (await isAllowlistedAdmin(userId)) return withOwner(toProjectDto(doc))
      if (doc.visibility !== 'public') throw new ActionForbiddenError()
      const dto = toSharedProjectDto(doc)
      delete dto.seedContext
      return withOwner(dto)
    }
    if (acl.ownerId === userId) return withOwner(toProjectDto(doc))
    const dto = toSharedProjectDto(doc)
    // Viewers see the lecture list, not the instructor's prep notes
    if (!canEditAcl(acl, userId)) delete dto.seedContext
    return withOwner(dto)
  },
})

export const projectUpdate = defineAction<
  ProjectUpdateInput,
  Project,
  ProjectSettingsAccess
>({
  name: 'project.update',
  access: settingsOf,
  input: z.object({
    projectId: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    course: z.string().optional(),
    description: z.string().optional(),
    seedContext: z.string().max(20_000).optional(),
    generationFreedom: z.number().int().min(1).max(5).nullable().optional(),
    language: z.enum(LOCALES).nullable().optional(),
    ttsVoice: ttsVoiceIdSchema.nullable().optional(),
  }),
  execute: (ctx, input, access) =>
    withProjectSettingsAudit(access, async doc => {
      if (input.title !== undefined) doc.title = input.title
      if (input.course !== undefined) doc.course = input.course
      if (input.description !== undefined) doc.description = input.description
      if (input.seedContext !== undefined) doc.seedContext = input.seedContext
      if (input.generationFreedom !== undefined) {
        // null clears back to the server default (stores nothing)
        doc.generationFreedom = input.generationFreedom ?? undefined
      }
      if (input.language !== undefined) {
        // null clears back to inherited (stores nothing)
        doc.language = input.language ?? undefined
      }
      if (input.ttsVoice !== undefined) {
        // null clears back to the server default (stores nothing)
        doc.ttsVoice = input.ttsVoice ?? undefined
      }
      await doc.save()
      return toProjectDto(doc)
    }),
})

/**
 * Sets the order the project's owner has dragged its lectures into (PROJ-4).
 * Mirrors deck.reorderSlides: the full array must be a permutation of the
 * project's current (live) lecture ids — not a superset or a subset — which
 * is what stops a stale client dropping or duplicating one. Owner-only,
 * verbatim from the SPEC ("A project's owner can drag its lectures"),
 * unlike most project changes which an editor may also make: an editor
 * already reshapes any lecture's content, but the shelf they sit on is the
 * owner's arrangement to set, the same way project.delete is stricter than
 * its settings siblings.
 */
export const projectReorderLectures = defineAction<
  ProjectReorderLecturesInput,
  Project,
  ProjectAccess
>({
  name: 'project.reorderLectures',
  access: ownerOf,
  input: z.object({
    projectId: z.string().min(1),
    lectureOrder: z.array(z.string().min(1)).min(1),
  }),
  execute: async (_ctx, input, { project, userId }) => {
    // Live decks only — a soft-deleted one is not part of "the project's
    // current lectures" to reorder, and DeckModel.find already excludes it.
    // Sorted newest-first and run through the project's CURRENT stored
    // order (if any), so this is the exact sequence deck.list would have
    // handed the owner to build the array it is now sending back.
    const decks = await DeckModel.find({
      projectId: input.projectId,
    }).sort({ updatedAt: -1 })
    const currentFull = orderByLectureOrder(
      decks,
      d => d._id.toString(),
      project.lectureOrder,
    )
    // Ownership does not imply visibility: a lecture handed to someone
    // else (deck.transferOwnership) who then revokes the former owner's
    // access is still in the project, but deck.list's per-row ACL filter
    // (canViewAcl) already hid it from whatever list the client built this
    // array from. Checking the proposal against every live deck — rather
    // than the subset the caller could ever have been shown — means a
    // lecture like that wedges every future reorder with a permanent 400.
    const acls = await loadDeckAcls(decks)
    const visiblePositions: number[] = []
    currentFull.forEach((d, i) => {
      if (canViewAcl(acls.get(d._id.toString())!, userId)) {
        visiblePositions.push(i)
      }
    })
    const current = visiblePositions
      .map(i => currentFull[i]!._id.toString())
      .sort()
    const proposed = [...input.lectureOrder].sort()
    if (
      current.length !== proposed.length ||
      current.some((id, i) => id !== proposed[i])
    ) {
      throw new ActionValidationError('project.reorderLectures', [
        'lectureOrder must contain exactly the caller’s visible lecture ids',
      ])
    }
    // Splice the caller's new order back into the visible slots; a lecture
    // they cannot see keeps the position it already held rather than being
    // dropped from the stored order (and rather than letting the caller
    // move something they never knew was there).
    const next = currentFull.map(d => d._id.toString())
    visiblePositions.forEach((pos, k) => {
      next[pos] = input.lectureOrder[k]!
    })
    project.lectureOrder = next
    await project.save()
    return toProjectDto(project)
  },
})

export const projectDelete = defineAction<
  ProjectDeleteInput,
  { deleted: true },
  ProjectAccess
>({
  name: 'project.delete',
  // Owner-only, deliberately stricter than the editor gate its siblings
  // use: deleting a course is not something a collaborator may do.
  access: ownerOf,
  input: z.object({ projectId: z.string().min(1) }),
  execute: async (_ctx, input) => {
    // Cascade: every deck in the project, their slides, all seed
    // material at both levels (including stored files), transcripts,
    // refine jobs, retained recordings, then the project
    await deleteProjectCascade(input.projectId)
    return { deleted: true }
  },
})

export const projectSetAccess = defineAction<
  ProjectSetAccessInput,
  Project,
  ProjectSettingsAccess
>({
  name: 'project.setAccess',
  access: settingsOf,
  input: z.object({
    projectId: z.string().min(1),
    visibility: z.enum(['restricted', 'public']),
  }),
  execute: async (ctx, input, access) => {
    // Publishing to everyone is the one capability an unconfirmed account
    // does not get (AUTH-3). Going back to restricted is always allowed.
    if (input.visibility === 'public' && ctx.userId) {
      await requireVerifiedEmail(ctx.userId)
    }
    return withProjectSettingsAudit(access, async doc => {
      doc.visibility = input.visibility
      await doc.save()
      return toProjectDto(doc)
    })
  },
})

export const projectShare = defineAction<
  ProjectShareInput,
  DeckShare[],
  ProjectSettingsAccess
>({
  name: 'project.share',
  access: settingsOf,
  input: z.object({
    projectId: z.string().min(1),
    email: z.email(),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: (ctx, input, access) =>
    withProjectSettingsAudit(access, async doc => {
      const user = await UserModel.findOne({
        email: input.email.toLowerCase().trim(),
      })
      if (!user) {
        throw new ActionValidationError('project.share', [
          'email: no account with that email',
        ])
      }
      const userId = user._id.toString()
      if (userId === doc.ownerId.toString()) {
        throw new ActionValidationError('project.share', [
          'email: that user owns this project',
        ])
      }
      const list = input.role === 'editor' ? doc.editors : doc.viewers
      if (!list.includes(userId)) list.push(userId)
      // One role per user: granting one revokes the other
      const other = input.role === 'editor' ? doc.viewers : doc.editors
      const index = other.indexOf(userId)
      if (index >= 0) other.splice(index, 1)
      await doc.save()
      return sharesOfAcl(projectAcl(doc))
    }),
})

export const projectUnshare = defineAction<
  ProjectUnshareInput,
  DeckShare[],
  ProjectSettingsAccess
>({
  name: 'project.unshare',
  access: settingsOf,
  input: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: (ctx, input, access) =>
    withProjectSettingsAudit(access, async doc => {
      const list = input.role === 'editor' ? doc.editors : doc.viewers
      const index = list.indexOf(input.userId)
      if (index >= 0) {
        list.splice(index, 1)
        await doc.save()
      }
      return sharesOfAcl(projectAcl(doc))
    }),
})

/** Who a project is shared with — a read, on the settings gate; see
 * `deck.shares`. */
export const projectShares = defineAction<
  ProjectSharesInput,
  DeckShare[],
  ProjectAccess
>({
  name: 'project.shares',
  access: settingsReadOf,
  input: z.object({ projectId: z.string().min(1) }),
  execute: (ctx, input, { acl }) => sharesOfAcl(acl),
})

/** Sets the default template new lectures start from (TMPL-2). */
export const projectSwitchTemplate = defineAction<
  ProjectSwitchTemplateInput,
  Project,
  ProjectSettingsAccess
>({
  name: 'project.switchTemplate',
  access: settingsOf,
  input: z.object({
    projectId: z.string().min(1),
    templateId: z.string().min(1),
  }),
  execute: (ctx, input, access) =>
    withProjectSettingsAudit(access, async doc => {
      if (!(await templateExists(input.templateId))) {
        throw new ActionValidationError('project.switchTemplate', [
          'templateId: unknown template',
        ])
      }
      doc.templateId = input.templateId
      await doc.save()
      return toProjectDto(doc)
    }),
})

export const projectTransferOwnership = defineAction<
  ProjectTransferOwnershipInput,
  Project,
  ProjectAccess
>({
  name: 'project.transferOwnership',
  access: ownerOf,
  input: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
  }),
  execute: async (ctx, input, { userId, project: doc }) => {
    const target = await UserModel.findById(input.userId).catch(() => null)
    if (!target) {
      throw new ActionValidationError('project.transferOwnership', [
        'userId: no such user',
      ])
    }
    const targetId = target._id.toString()
    if (targetId === userId) {
      throw new ActionValidationError('project.transferOwnership', [
        'userId: already the owner',
      ])
    }
    const before = projectSettingsSnapshot(doc)
    // The new owner leaves the people list; the old owner stays an editor
    doc.viewers = doc.viewers.filter(id => id !== targetId)
    doc.editors = doc.editors.filter(id => id !== targetId)
    if (!doc.editors.includes(userId)) doc.editors.push(userId)
    doc.ownerId = target._id
    await doc.save()
    // Owner-only, so it never reaches editProjectSettings — it logs the
    // change itself. The entry is filed under whoever owns the project
    // now, so its history follows the settings.
    await recordSettingsChange({
      actorId: userId,
      actorRole: 'owner',
      entityType: 'project',
      entityId: doc._id.toString(),
      entityName: doc.title,
      ownerId: targetId,
      before,
      after: projectSettingsSnapshot(doc),
    })
    // The caller is no longer the owner, so share lists stay behind
    return toSharedProjectDto(doc)
  },
})

registerAction(projectCreate)
registerAction(projectList)
registerAction(projectGet)
registerAction(projectUpdate)
registerAction(projectReorderLectures)
registerAction(projectDelete)
registerAction(projectSetAccess)
registerAction(projectSwitchTemplate)
registerAction(projectShare)
registerAction(projectUnshare)
registerAction(projectShares)
registerAction(projectTransferOwnership)
