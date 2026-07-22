/**
 * Admin private-view grant model. One row means "this admin has enabled
 * viewing this user's private lectures" — the toggle on the admin user
 * page. Off by default (no row); enabling and disabling are recorded in
 * the admin action log, and every private lecture actually viewed
 * through the grant is logged too (routes/decks.ts).
 */
import { Schema, model, Types } from 'mongoose'
import { UserModel } from './user'
import { isAdminEmail } from '../config/admin'

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

/**
 * Resolves a requester to an admin identity if — and only if — they are
 * an allowlisted admin currently holding a private-view grant for
 * `ownerId`'s lectures. Returns null otherwise (including for stale
 * grants whose holder has left the allowlist). The grant is checked
 * first: for the common no-grant case this is one indexed lookup.
 */
export const privateViewGrantee = async (
  userId: string | undefined,
  ownerId: string,
): Promise<{ id: string; email: string } | null> => {
  if (!userId) return null
  const grant = await AdminPrivateAccessModel.exists({
    adminId: userId,
    targetUserId: ownerId,
  })
  if (!grant) return null
  const user = await UserModel.findById(userId)
  if (!user || !isAdminEmail(user.email)) return null
  return { id: user._id.toString(), email: user.email }
}
