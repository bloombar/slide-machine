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
import type { ProjectDb } from '../models/project'
import { loadDeckAcl, type DeckDb } from '../models/deck'
import { logAdminAction } from '../audit/log'
import { recordSettingsChange } from '../audit/settings-log'
import type { ResolvedAcl } from './access'
import type {
  AdminActor,
  DeckSettingsAccess,
  ProjectSettingsAccess,
} from '../actions/access'
import { diffSettings } from './settings-diff'
import {
  deckSettingsSnapshot,
  projectSettingsSnapshot,
} from './settings-snapshot'

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

/**
 * Records what `apply` changed about a project's settings.
 *
 * The admitting half of this — owner or editor, otherwise an allowlisted
 * admin — is now the `projectSettings` access policy, so by the time this runs
 * the actor is settled and the document is loaded. What is left is the part
 * that has to bracket the change: snapshot, apply, diff, log.
 *
 * An admin's edit is additionally audited (ADMIN-5). An empty diff writes
 * nothing, which is what keeps the read-only `project.shares` action — which
 * rides this wrapper to reuse its admission rule — out of the logs.
 */
export const withProjectSettingsAudit = async <T>(
  access: ProjectSettingsAccess,
  apply: (doc: HydratedDocument<ProjectDb>) => Promise<T>,
): Promise<T> => {
  const { userId, project: doc, acl, admin } = access

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
 * Records what `apply` changed about a lecture's settings.
 *
 * The admitting half is the `deckSettings` access policy; this is the
 * bracketing half. `apply` receives the ACL resolved when the caller was
 * authorized, and the "after" snapshot **re-resolves it**, because adding or
 * dropping an access override moves where a lecture's effective access comes
 * from — reusing the earlier value would record a diff that never happened
 * for deck.setAccess and deck.resetAccess.
 *
 * An empty diff writes nothing, which is what keeps the read-only
 * `deck.shares` action out of the logs.
 */
export const withDeckSettingsAudit = async <T>(
  access: DeckSettingsAccess,
  apply: (doc: HydratedDocument<DeckDb>, acl: ResolvedAcl) => Promise<T>,
): Promise<T> => {
  const { userId, deck: doc, acl, admin } = access

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
