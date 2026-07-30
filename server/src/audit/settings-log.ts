/**
 * Settings change logger — the single write path into the settings change
 * log. Every settings edit on the platform ends here, whoever made it:
 *
 * - account settings — actions/user.ts (the owner) and
 *   routes/admin-settings.ts (an admin editing on their behalf);
 * - project and lecture settings — lib/admin-edit.ts, which wraps every
 *   settings action, plus the two ownership transfers that bypass it.
 *
 * Separate from the admin action log (audit/log.ts), which records only
 * what admins do; an admin's settings edit lands in both.
 */
import type {
  SettingsActorRole,
  SettingsChanges,
  SettingsEntityType,
} from '@slide-machine/shared'
import { SettingsChangeLogModel } from '../models/settings-change-log'
import { UserModel } from '../models/user'
import { diffSettings } from '../lib/settings-diff'

/** What a call site records once it knows which fields changed. */
export interface SettingsChangeInput {
  actorId: string
  /** The acting user's email, snapshotted; blank if unknown. */
  actorEmail: string
  actorRole: SettingsActorRole
  entityType: SettingsEntityType
  entityId: string
  /** The entity's name at the time — an email for accounts, a title for
   * projects and lectures. */
  entityName?: string
  /** Whose settings these are: the account itself for `user` entries,
   * otherwise the project's or lecture's owner. */
  ownerId: string
  changes: SettingsChanges
}

/**
 * Appends one entry to the settings change log. Never throws: a failed
 * log write is reported to the console but must not break the edit it
 * accompanies. Awaitable so tests and callers can sequence it.
 */
export const logSettingsChange = async (
  entry: SettingsChangeInput,
): Promise<void> => {
  try {
    await SettingsChangeLogModel.create(entry)
  } catch (err) {
    console.error('settings log write failed', err)
  }
}

/** What a call site passes: the two snapshots taken around the edit
 * (lib/settings-snapshot.ts) instead of a ready-made change set. */
export interface SettingsChangeRecord<T extends object> extends Omit<
  SettingsChangeInput,
  'actorEmail' | 'changes'
> {
  /** The acting user's email, when the caller already has it. Left out,
   * it is looked up — but only if something actually changed. */
  actorEmail?: string
  before: T
  after: T
}

/**
 * Diffs two settings snapshots and appends an entry describing what
 * changed. An edit that changed nothing writes nothing — and costs
 * nothing beyond the diff, since the actor's email is only fetched once a
 * real change is found.
 */
export const recordSettingsChange = async <T extends object>(
  entry: SettingsChangeRecord<T>,
): Promise<void> => {
  const changes = diffSettings(entry.before, entry.after)
  if (!Object.keys(changes).length) return
  const actorEmail =
    entry.actorEmail ??
    (await UserModel.findById(entry.actorId).catch(() => null))?.email ??
    ''
  await logSettingsChange({
    actorId: entry.actorId,
    actorEmail,
    actorRole: entry.actorRole,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityName: entry.entityName,
    ownerId: entry.ownerId,
    changes,
  })
}
