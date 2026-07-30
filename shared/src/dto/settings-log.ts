/**
 * DTOs for the settings change log (GET /api/admin/settings-logs and its
 * CSV export).
 *
 * This is a separate log from the admin action log (dto/admin-log.ts).
 * That one answers "what have admins done"; this one answers "how did
 * this account's, project's, or lecture's settings get this way" — every
 * settings change on the platform, whoever made it: the owner, a
 * collaborator with edit access, or an admin editing on their behalf.
 * An admin's settings edit therefore appears in both.
 *
 * See docs/ADMINISTRATION.md ("Settings change log").
 */

/** The kinds of entity that have settings. */
export const SETTINGS_ENTITY_TYPES = ['user', 'project', 'deck'] as const

/** Which entity's settings an entry describes: an account, a project, or
 * a lecture (`deck`, the internal name for a lecture). */
export type SettingsEntityType = (typeof SETTINGS_ENTITY_TYPES)[number]

/** The roles an entry's actor can have acted in. */
export const SETTINGS_ACTOR_ROLES = ['owner', 'editor', 'admin'] as const

/**
 * How the actor was entitled to make the change: the entity's `owner`,
 * an `editor` it is shared with, or an allowlisted `admin` overriding the
 * ACL (ADMIN-5). Account settings are only ever `owner` or `admin`.
 */
export type SettingsActorRole = (typeof SETTINGS_ACTOR_ROLES)[number]

/** One field's value before and after the change. */
export interface SettingsFieldChange {
  from: unknown
  to: unknown
}

/** The changed fields of one edit, keyed by settings field name. Only
 * fields that really changed appear, so this is never empty. */
export type SettingsChanges = Record<string, SettingsFieldChange>

/** One append-only record of a settings change. */
export interface SettingsLogEntry {
  id: string
  /** The acting user's id. */
  actorId: string
  /** The acting user's email, snapshotted at the time of the change.
   * Empty when the account was gone by the time the entry was written. */
  actorEmail: string
  /** SettingsActorRole; open string on the wire so historic entries
   * survive vocabulary changes (writes are typed). */
  actorRole: string
  /** SettingsEntityType; open on the wire for the same reason. */
  entityType: string
  entityId: string
  /** The entity's name when it changed — an email for accounts, a title
   * for projects and lectures. Absent when it had none. */
  entityName?: string
  /** Whose settings these are: the account itself for `user` entries,
   * otherwise the project's or lecture's owner. */
  ownerId: string
  /** What changed, keyed by field name. */
  changes: SettingsChanges
  /** ISO timestamp of when the change happened. */
  createdAt: string
}

export interface SettingsLogsResponse {
  logs: SettingsLogEntry[]
  total: number
  page: number
  limit: number
}
