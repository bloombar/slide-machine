/**
 * Admin settings override on the product path (ADMIN-5). An allowlisted
 * admin edits another user's project or lecture from the ordinary
 * owner-facing settings UI, not from a separate console form: these two
 * wrappers grant the access the ACL would otherwise refuse, and record
 * what changed in the admin audit log.
 *
 * Only the settings actions route through here — slides, recordings,
 * refine runs, quizzes, and exports keep the plain editor check, so an
 * admin's view of someone else's content stays read-only (ADMIN-3).
 *
 * The audit entry is a diff of two snapshots taken around the mutation,
 * not of the input: mongoose setters and the lecture's copy-on-write ACL
 * make an input-vs-document comparison lie, and re-saving the same value
 * costs nothing this way. An edit that changes nothing writes no entry.
 * See docs/ADMINISTRATION.md ("Editing settings").
 */
import type { HydratedDocument } from 'mongoose'
import type { AdminAction } from '@slide-machine/shared'
import { ProjectModel, projectAcl, type ProjectDb } from '../models/project'
import { DeckModel, loadDeckAcl, type DeckDb } from '../models/deck'
import { UserModel } from '../models/user'
import { isAdminEmail } from '../config/admin'
import { logAdminAction } from '../audit/log'
import { canEditAcl, type ResolvedAcl } from './access'
import { diffSettings } from './settings-diff'
import { ActionForbiddenError } from '../actions/dispatch'
import type { ActionContext } from '../actions/context'

/** The acting admin, as the audit log records them. */
interface AdminActor {
  id: string
  email: string
}

/**
 * The admin behind an override, or a refusal. Two accounts are checked:
 * the actor must be allowlisted, and the entity's owner must not be —
 * admins moderate but are not moderated (ADMIN-1), so an admin's own
 * content is off limits here exactly as it is in the console.
 */
const overrideActor = async (
  userId: string,
  ownerId: string,
): Promise<AdminActor> => {
  const actor = await UserModel.findById(userId).catch(() => null)
  if (!actor || !isAdminEmail(actor.email)) throw new ActionForbiddenError()
  const owner = await UserModel.findById(ownerId).catch(() => null)
  if (owner && isAdminEmail(owner.email)) throw new ActionForbiddenError()
  return { id: actor._id.toString(), email: actor.email }
}

/** A people list as one comparable, loggable value: its ids, sorted so a
 * reordering alone never reads as a change. */
const people = (ids: string[]): string => [...ids].sort().join(', ')

/** The project settings an admin can reach from the settings modal. */
const projectSnapshot = (doc: HydratedDocument<ProjectDb>) => ({
  title: doc.title,
  visibility: doc.visibility,
  templateId: doc.templateId,
  seedContext: doc.seedContext,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  viewers: people(doc.viewers ?? []),
  editors: people(doc.editors ?? []),
})

/**
 * The lecture settings an admin can reach from the settings modal.
 * `visibility` is the EFFECTIVE one and `accessInherited` says where it
 * came from: pinning a lecture to the visibility it already inherits
 * still detaches it from its project, and that flag is the only signal.
 */
const deckSnapshot = (doc: HydratedDocument<DeckDb>, acl: ResolvedAcl) => ({
  title: doc.title,
  visibility: acl.visibility,
  accessInherited: acl.inherited,
  templateId: doc.templateId,
  seedContext: doc.seedContext,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  refineIdentifySpeakers: doc.refineIdentifySpeakers,
  refineSlidesEnabled: doc.refineSlidesEnabled,
  refineSlidesLevel: doc.refineSlidesLevel,
  refineTranscriptEnabled: doc.refineTranscriptEnabled,
  refineTranscriptLevel: doc.refineTranscriptLevel,
  viewers: people(acl.viewers),
  editors: people(acl.editors),
})

/** Appends one audit entry, unless the two snapshots are identical. */
const recordChanges = async <T extends object>(
  actor: AdminActor,
  before: T,
  after: T,
  entry: {
    action: AdminAction
    targetType: string
    targetId: string
    details: Record<string, unknown>
  },
): Promise<void> => {
  const changes = diffSettings(before, after)
  if (!Object.keys(changes).length) return
  await logAdminAction({
    actorId: actor.id,
    actorEmail: actor.email,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: { ...entry.details, changes },
  })
}

/** The acting user's id, or a refusal; every override starts signed in. */
const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/**
 * Runs `apply` against a project the actor may change the settings of:
 * an owner or editor as usual, otherwise an allowlisted admin, whose
 * edit is audited. Throws ActionForbiddenError for anyone else, and for
 * a missing project (no existence leaks).
 */
export const editProjectSettings = async <T>(
  ctx: ActionContext,
  projectId: string,
  apply: (doc: HydratedDocument<ProjectDb>) => Promise<T>,
): Promise<T> => {
  const userId = requireUser(ctx)
  const doc = await ProjectModel.findById(projectId).catch(() => null)
  if (!doc) throw new ActionForbiddenError()
  if (canEditAcl(projectAcl(doc), userId)) return apply(doc)

  const actor = await overrideActor(userId, doc.ownerId.toString())
  const before = projectSnapshot(doc)
  const result = await apply(doc)
  await recordChanges(actor, before, projectSnapshot(doc), {
    action: 'project.settings_update',
    targetType: 'project',
    targetId: doc._id.toString(),
    details: { title: doc.title, ownerId: doc.ownerId.toString() },
  })
  return result
}

/**
 * Runs `apply` against a lecture the actor may change the settings of:
 * an owner or editor as usual, otherwise an allowlisted admin, whose
 * edit is audited. `apply` receives the ACL resolved before it runs; the
 * audit diff re-resolves it afterwards, since dropping or adding an
 * access override moves where the effective access comes from.
 */
export const editDeckSettings = async <T>(
  ctx: ActionContext,
  deckId: string,
  apply: (doc: HydratedDocument<DeckDb>, acl: ResolvedAcl) => Promise<T>,
): Promise<T> => {
  const userId = requireUser(ctx)
  const doc = await DeckModel.findById(deckId).catch(() => null)
  if (!doc) throw new ActionForbiddenError()
  const acl = await loadDeckAcl(doc)
  if (canEditAcl(acl, userId)) return apply(doc, acl)

  const actor = await overrideActor(userId, doc.ownerId.toString())
  const before = deckSnapshot(doc, acl)
  const result = await apply(doc, acl)
  await recordChanges(
    actor,
    before,
    deckSnapshot(doc, await loadDeckAcl(doc)),
    {
      action: 'deck.settings_update',
      targetType: 'deck',
      targetId: doc._id.toString(),
      details: { title: doc.title, ownerId: doc.ownerId.toString() },
    },
  )
  return result
}
