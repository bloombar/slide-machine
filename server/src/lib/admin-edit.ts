/**
 * The write path for project and lecture settings, and the admin override
 * on it (ADMIN-5). Every action that changes a project's or lecture's
 * settings runs inside one of these two wrappers, which:
 *
 * 1. admit the actor — an owner or editor as usual, or an allowlisted
 *    admin editing another user's entity from the ordinary owner-facing
 *    settings UI rather than a separate console form;
 * 2. record what changed in the settings change log, whoever made it;
 * 3. record an admin's edit in the admin audit log as well.
 *
 * Only the settings actions route through here — slides, recordings,
 * refine runs, quizzes, and exports keep the plain editor check, so an
 * admin's view of someone else's content stays read-only (ADMIN-3).
 *
 * Both entries are a diff of two snapshots taken around the mutation, not
 * of the input: mongoose setters and the lecture's copy-on-write ACL make
 * an input-vs-document comparison lie, and re-saving the same value costs
 * nothing this way. An edit that changes nothing writes no entry — which
 * is also what keeps the read-only actions routed through here (
 * `project.shares`, `deck.shares`) out of the logs. See
 * docs/ADMINISTRATION.md ("Editing settings", "Settings change log").
 */
import type { HydratedDocument } from 'mongoose'
import type { AdminAction, SettingsActorRole } from '@slide-machine/shared'
import { ProjectModel, projectAcl, type ProjectDb } from '../models/project'
import { DeckModel, loadDeckAcl, type DeckDb } from '../models/deck'
import { UserModel } from '../models/user'
import { isAdminEmail } from '../config/admin'
import { logAdminAction } from '../audit/log'
import { recordSettingsChange } from '../audit/settings-log'
import { canEditAcl, type ResolvedAcl } from './access'
import { diffSettings } from './settings-diff'
import {
  deckSettingsSnapshot,
  projectSettingsSnapshot,
} from './settings-snapshot'
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

/** How the actor was entitled to edit, for the settings change log: the
 * owner, an editor they shared with, or an admin overriding the ACL. */
const roleOf = (
  acl: ResolvedAcl,
  userId: string,
  isAdmin: boolean,
): SettingsActorRole => {
  if (isAdmin) return 'admin'
  return acl.ownerId === userId ? 'owner' : 'editor'
}

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
 * an owner or editor as usual, otherwise an allowlisted admin. Throws
 * ActionForbiddenError for anyone else, and for a missing project (no
 * existence leaks). Whatever it changes is recorded in the settings
 * change log; an admin's edit is additionally audited.
 */
export const editProjectSettings = async <T>(
  ctx: ActionContext,
  projectId: string,
  apply: (doc: HydratedDocument<ProjectDb>) => Promise<T>,
): Promise<T> => {
  const userId = requireUser(ctx)
  const doc = await ProjectModel.findById(projectId).catch(() => null)
  if (!doc) throw new ActionForbiddenError()
  const acl = projectAcl(doc)
  const admin = canEditAcl(acl, userId)
    ? null
    : await overrideActor(userId, doc.ownerId.toString())

  const before = projectSettingsSnapshot(doc)
  const result = await apply(doc)
  const after = projectSettingsSnapshot(doc)

  if (admin) {
    await recordChanges(admin, before, after, {
      action: 'project.settings_update',
      targetType: 'project',
      targetId: doc._id.toString(),
      details: { title: doc.title, ownerId: doc.ownerId.toString() },
    })
  }
  await recordSettingsChange({
    actorId: userId,
    actorEmail: admin?.email,
    actorRole: roleOf(acl, userId, !!admin),
    entityType: 'project',
    entityId: doc._id.toString(),
    entityName: doc.title,
    ownerId: doc.ownerId.toString(),
    before,
    after,
  })
  return result
}

/**
 * Runs `apply` against a lecture the actor may change the settings of:
 * an owner or editor as usual, otherwise an allowlisted admin. `apply`
 * receives the ACL resolved before it runs; the diff re-resolves it
 * afterwards, since dropping or adding an access override moves where the
 * effective access comes from. Whatever it changes is recorded in the
 * settings change log; an admin's edit is additionally audited.
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
  const admin = canEditAcl(acl, userId)
    ? null
    : await overrideActor(userId, doc.ownerId.toString())

  const before = deckSettingsSnapshot(doc, acl)
  const result = await apply(doc, acl)
  const after = deckSettingsSnapshot(doc, await loadDeckAcl(doc))

  if (admin) {
    await recordChanges(admin, before, after, {
      action: 'deck.settings_update',
      targetType: 'deck',
      targetId: doc._id.toString(),
      details: { title: doc.title, ownerId: doc.ownerId.toString() },
    })
  }
  await recordSettingsChange({
    actorId: userId,
    actorEmail: admin?.email,
    actorRole: roleOf(acl, userId, !!admin),
    entityType: 'deck',
    entityId: doc._id.toString(),
    entityName: doc.title,
    ownerId: doc.ownerId.toString(),
    before,
    after,
  })
  return result
}
