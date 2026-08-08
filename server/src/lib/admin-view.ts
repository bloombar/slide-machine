/**
 * The admin bypass on the product's own read paths, and the audit entry
 * that covers what it exposes.
 *
 * Allowlisted admins may always open a lecture, project, or profile in the
 * product itself, read-only — the ADMIN_EMAILS gate is the authorization,
 * mirroring the admin API's ACL bypass. The bypass reaches **soft-deleted**
 * records too (ADMIN-6): a tombstoned record is hidden from every other
 * reader (P-10), but an admin opens it exactly as they open a live one, for
 * recovery and audit, until the retention sweep purges it.
 *
 * Every such opening is recorded in the admin audit log (ADMIN-7 / P-13),
 * as an admin's view of private content is. Unlike the private-view log,
 * this one is written by the read itself rather than by a POST the client
 * volunteers: the deleted content is in the response, so the audit trail
 * must not depend on the caller reporting it.
 */
import type { AdminAction } from '@slide-machine/shared'
import { UserModel } from '../models/user'
import { isAdminEmail } from '../config/admin'
import { logAdminAction } from '../audit/log'

/** The acting admin behind a bypass: their id, and the email the audit log
 * snapshots alongside it. */
export interface AdminViewer {
  id: string
  email: string
}

/**
 * The requester as an admin, or null if they are not allowlisted. A
 * tombstoned account never resolves — its sessions are ended at deletion, so
 * it has no way to be the requester in the first place.
 */
export const adminViewer = async (
  userId: string | undefined,
): Promise<AdminViewer | null> => {
  if (!userId) return null
  const user = await UserModel.findById(userId).catch(() => null)
  if (!user || !isAdminEmail(user.email)) return null
  return { id: user._id.toString(), email: user.email }
}

/** Whether this requester (if any) is an allowlisted admin. */
export const isAllowlistedAdmin = async (
  userId: string | undefined,
): Promise<boolean> => (await adminViewer(userId)) !== null

/** Query options that let a read see tombstoned records (P-10). */
export const withDeleted = { withDeleted: true } as const

/**
 * Filter fragment that shows a tombstoned record's children as its owner
 * last saw them: those tombstoned in the same cascade (`deletedAt` at or
 * after the parent's — exactly what a restore would bring back), plus any
 * still live. Children the owner had deleted earlier stay hidden, so the
 * admin sees the lecture as it stood when it was deleted rather than every
 * slide it ever had. Pair it with `withDeleted`, since the `$or` keeps the
 * plugin from recognizing the `deletedAt` constraint.
 */
export const deletedWith = (at: Date) => ({
  $or: [{ deletedAt: null }, { deletedAt: { $gte: at } }],
})

/**
 * Reading options for content under a record that may or may not be
 * tombstoned: nothing extra while it is live (so an individually deleted
 * child stays hidden), and its own cascade's rows once it is not.
 */
export const asOf = (deletedAt: Date | null | undefined) =>
  deletedAt
    ? { filter: deletedWith(deletedAt), options: withDeleted }
    : { filter: {}, options: {} }

/**
 * Records that an admin opened soft-deleted content — one entry per
 * opening, as ADMIN-6 requires every access to soft-deleted content to be
 * audited. Only the primary reads call this: the console's directories
 * merely badge their rows, and logging every page of them would bury the
 * log.
 */
export const logDeletedView = async (
  admin: AdminViewer,
  action: AdminAction,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action,
    targetType,
    targetId,
    details,
  })
}
