/**
 * Admin identity check for view-path bypasses. Allowlisted admins may
 * always open any lecture in the viewer (read-only) — the ADMIN_EMAILS
 * gate is the authorization, mirroring the admin API's ACL bypass. The
 * admin console lists every lecture, private or not, on the same basis.
 */
import { UserModel } from '../models/user'
import { isAdminEmail } from '../config/admin'

/** Whether this requester (if any) is an allowlisted admin. */
export const isAllowlistedAdmin = async (
  userId: string | undefined,
): Promise<boolean> => {
  if (!userId) return false
  const user = await UserModel.findById(userId)
  return user !== null && isAdminEmail(user.email)
}
