/**
 * Admin private-view toggle model. One row means "this admin has turned
 * on listing this user's private lectures on the admin user page" —
 * the checkbox there. Off by default (no row); enabling and disabling
 * are recorded in the admin action log. Note this only controls what
 * the admin LISTING shows: opening a lecture in the viewer is always
 * allowed for allowlisted admins (lib/admin-view.ts).
 */
import { Schema, model, Types } from 'mongoose'

export interface AdminPrivateAccessDb {
  /** The admin holding the grant. */
  adminId: Types.ObjectId
  /** The user whose private lectures the grant covers. */
  targetUserId: Types.ObjectId
  createdAt: Date
}

const adminPrivateAccessSchema = new Schema<AdminPrivateAccessDb>(
  {
    adminId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    targetUserId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

adminPrivateAccessSchema.index(
  { adminId: 1, targetUserId: 1 },
  { unique: true },
)

export const AdminPrivateAccessModel = model<AdminPrivateAccessDb>(
  'AdminPrivateAccess',
  adminPrivateAccessSchema,
)
