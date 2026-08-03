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
import { canEditAcl, isAclMember } from '../lib/access'
import { isAllowlistedAdmin } from '../lib/admin-view'
import { editProjectSettings } from '../lib/admin-edit'
import { recordSettingsChange } from '../audit/settings-log'
import { projectSettingsSnapshot } from '../lib/settings-snapshot'
import { ttsVoiceIdSchema } from '../lib/tts-voice'
import { sharesOfAcl } from '../lib/shares'
import { getBuiltinTemplate } from '../templates/builtin'
import type { HydratedDocument, Types } from 'mongoose'
import { DeckModel } from '../models/deck'
import { deleteProjectCascade } from '../lib/cascade'

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

export const projectCreate = defineAction<ProjectCreateInput, Project>({
  name: 'project.create',
  input: z.object({
    // Blank is allowed: a titleless project is the "default" one created
    // for a user's first lecture; the client shows a placeholder name.
    title: z.string().trim().default(''),
    course: z.string().optional(),
    description: z.string().optional(),
    seedContext: z.string().optional(),
  }),
  execute: async (ctx, input) => {
    const doc = await ProjectModel.create({
      ...input,
      ownerId: requireUser(ctx),
    })
    return toProjectDto(doc)
  },
})

export const projectList = defineAction<Record<string, never>, Project[]>({
  name: 'project.list',
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

export const projectGet = defineAction<{ projectId: string }, Project>({
  name: 'project.get',
  input: z.object({ projectId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId).catch(() => null)
    const acl = doc ? projectAcl(doc) : null
    if (!doc || !acl) throw new ActionForbiddenError()
    // Non-members: allowlisted admins get an always-on bypass, mirroring the
    // lecture-viewer one (lib/admin-view.ts). They read the full project, seed
    // notes and people lists included: the console already surfaces both, and
    // the settings modal they edit from reads them (ADMIN-5). Everyone else may
    // read a PUBLIC project (SOC discovery) — but only its shareable shape: the
    // people lists and prep notes are stripped, and deck.list still hides its
    // non-public lectures. A restricted project stays members-only (404).
    if (!isAclMember(acl, userId)) {
      if (await isAllowlistedAdmin(userId)) return toProjectDto(doc)
      if (doc.visibility !== 'public') throw new ActionForbiddenError()
      const dto = toSharedProjectDto(doc)
      delete dto.seedContext
      return dto
    }
    if (acl.ownerId === userId) return toProjectDto(doc)
    const dto = toSharedProjectDto(doc)
    // Viewers see the lecture list, not the instructor's prep notes
    if (!canEditAcl(acl, userId)) delete dto.seedContext
    return dto
  },
})

export const projectUpdate = defineAction<ProjectUpdateInput, Project>({
  name: 'project.update',
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
  execute: (ctx, input) =>
    editProjectSettings(ctx, input.projectId, async doc => {
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

export const projectDelete = defineAction<
  ProjectDeleteInput,
  { deleted: true }
>({
  name: 'project.delete',
  input: z.object({ projectId: z.string().min(1) }),
  authorize: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId)
    if (!doc || doc.ownerId.toString() !== userId) {
      // Same error for missing and foreign projects: no existence leaks
      throw new ActionForbiddenError()
    }
  },
  execute: async (_ctx, input) => {
    // Cascade: every deck in the project, their slides, all seed
    // material at both levels (including stored files), transcripts,
    // refine jobs, retained recordings, then the project
    await deleteProjectCascade(input.projectId)
    return { deleted: true }
  },
})

export const projectSetAccess = defineAction<ProjectSetAccessInput, Project>({
  name: 'project.setAccess',
  input: z.object({
    projectId: z.string().min(1),
    visibility: z.enum(['restricted', 'public']),
  }),
  execute: (ctx, input) =>
    editProjectSettings(ctx, input.projectId, async doc => {
      doc.visibility = input.visibility
      await doc.save()
      return toProjectDto(doc)
    }),
})

export const projectShare = defineAction<ProjectShareInput, DeckShare[]>({
  name: 'project.share',
  input: z.object({
    projectId: z.string().min(1),
    email: z.email(),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: (ctx, input) =>
    editProjectSettings(ctx, input.projectId, async doc => {
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

export const projectUnshare = defineAction<ProjectUnshareInput, DeckShare[]>({
  name: 'project.unshare',
  input: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: (ctx, input) =>
    editProjectSettings(ctx, input.projectId, async doc => {
      const list = input.role === 'editor' ? doc.editors : doc.viewers
      const index = list.indexOf(input.userId)
      if (index >= 0) {
        list.splice(index, 1)
        await doc.save()
      }
      return sharesOfAcl(projectAcl(doc))
    }),
})

export const projectShares = defineAction<ProjectSharesInput, DeckShare[]>({
  name: 'project.shares',
  input: z.object({ projectId: z.string().min(1) }),
  execute: (ctx, input) =>
    editProjectSettings(ctx, input.projectId, async doc =>
      sharesOfAcl(projectAcl(doc)),
    ),
})

/** Sets the default template new lectures start from (TMPL-2). */
export const projectSwitchTemplate = defineAction<
  ProjectSwitchTemplateInput,
  Project
>({
  name: 'project.switchTemplate',
  input: z.object({
    projectId: z.string().min(1),
    templateId: z.string().min(1),
  }),
  execute: (ctx, input) =>
    editProjectSettings(ctx, input.projectId, async doc => {
      if (!getBuiltinTemplate(input.templateId)) {
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
  Project
>({
  name: 'project.transferOwnership',
  input: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId).catch(() => null)
    // Owner-only, unlike the rest of access management
    if (!doc || doc.ownerId.toString() !== userId)
      throw new ActionForbiddenError()
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
registerAction(projectDelete)
registerAction(projectSetAccess)
registerAction(projectSwitchTemplate)
registerAction(projectShare)
registerAction(projectUnshare)
registerAction(projectShares)
registerAction(projectTransferOwnership)
