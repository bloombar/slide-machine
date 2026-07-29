/**
 * Settings change log model. Append-only by design, like the admin action
 * log it sits beside: entries are only ever created (via
 * audit/settings-log.ts) and read (via the settings-log routes) — no
 * update or delete path exists anywhere in the app. Indexed for the
 * newest-first listing plus the entity-kind, owner, and actor filters the
 * Settings changes page and its future views need.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { SettingsChanges, SettingsLogEntry } from '@slide-machine/shared'

export interface SettingsChangeLogDb {
  actorId: Types.ObjectId
  actorEmail: string
  actorRole: string
  entityType: string
  entityId: string
  entityName?: string
  ownerId: string
  changes: SettingsChanges
  createdAt: Date
}

const settingsChangeLogSchema = new Schema<SettingsChangeLogDb>(
  {
    actorId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    // Snapshotted, not joined: an entry must still name its actor after
    // the account is renamed or deleted. Blank when it was already gone.
    actorEmail: { type: String, default: '' },
    actorRole: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    entityName: String,
    ownerId: { type: String, required: true },
    // `{field: {from, to}}` for the fields that changed; the field names
    // are code-defined (lib/settings-snapshot.ts), never user input, so
    // they are always safe as Mongo keys. The CSV export stringifies it.
    changes: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

settingsChangeLogSchema.index({ createdAt: -1 })
settingsChangeLogSchema.index({ entityType: 1, createdAt: -1 })
settingsChangeLogSchema.index({ entityId: 1, createdAt: -1 })
settingsChangeLogSchema.index({ ownerId: 1, createdAt: -1 })
settingsChangeLogSchema.index({ actorId: 1, createdAt: -1 })

export const SettingsChangeLogModel = model<SettingsChangeLogDb>(
  'SettingsChangeLog',
  settingsChangeLogSchema,
)

/** Maps a log document to the shared wire shape. */
export const toSettingsLogEntryDto = (
  doc: HydratedDocument<SettingsChangeLogDb>,
): SettingsLogEntry => ({
  id: doc._id.toString(),
  actorId: doc.actorId.toString(),
  actorEmail: doc.actorEmail,
  actorRole: doc.actorRole,
  entityType: doc.entityType,
  entityId: doc.entityId,
  entityName: doc.entityName,
  ownerId: doc.ownerId,
  changes: doc.changes,
  createdAt: doc.createdAt.toISOString(),
})
