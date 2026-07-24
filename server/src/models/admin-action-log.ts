/**
 * Admin action audit log model. Append-only by design: entries are only
 * ever created (via audit/log.ts) and read (via the admin logs routes) —
 * no update or delete path exists anywhere in the app. Indexed for the
 * newest-first listing plus the anticipated actor/action filters.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { AdminLogEntry } from '@slide-machine/shared'

export interface AdminActionLogDb {
  actorId: Types.ObjectId
  actorEmail: string
  action: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
  createdAt: Date
}

const adminActionLogSchema = new Schema<AdminActionLogDb>(
  {
    actorId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    actorEmail: { type: String, required: true },
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    // Free-form, action-specific context; callers keep it small and
    // JSON-serializable (the CSV export stringifies it)
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

adminActionLogSchema.index({ createdAt: -1 })
adminActionLogSchema.index({ actorId: 1, createdAt: -1 })
adminActionLogSchema.index({ action: 1, createdAt: -1 })

export const AdminActionLogModel = model<AdminActionLogDb>(
  'AdminActionLog',
  adminActionLogSchema,
)

/** Maps a log document to the shared wire shape. */
export const toAdminLogEntryDto = (
  doc: HydratedDocument<AdminActionLogDb>,
): AdminLogEntry => ({
  id: doc._id.toString(),
  actorId: doc.actorId.toString(),
  actorEmail: doc.actorEmail,
  action: doc.action,
  targetType: doc.targetType,
  targetId: doc.targetId,
  details: doc.details,
  createdAt: doc.createdAt.toISOString(),
})
