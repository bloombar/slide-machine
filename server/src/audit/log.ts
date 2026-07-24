/**
 * Admin audit logger — the single write path into the admin action log.
 * Every admin feature that changes or exposes user data calls
 * logAdminAction; the log is surfaced at /app/admin/logs and exportable
 * as CSV (docs/ADMINISTRATION.md, "Audit log").
 */
import type { AdminAction } from '@slide-machine/shared'
import { AdminActionLogModel } from '../models/admin-action-log'

/** What a call site records. actorId/actorEmail come from req.adminUser
 * (set by requireAdmin), so handlers never re-query the acting admin. */
export interface AdminActionInput {
  actorId: string
  actorEmail: string
  /** Namespaced `noun.verb` action name, e.g. `user.delete`. */
  action: AdminAction
  targetType?: string
  targetId?: string
  /** Small, JSON-serializable context; the CSV export stringifies it. */
  details?: Record<string, unknown>
}

/**
 * Appends one entry to the admin action log. Never throws: a failed
 * audit write is reported to the console but must not break the admin
 * request it accompanies. Awaitable so tests and callers can sequence
 * it, but safe to call without awaiting.
 */
export const logAdminAction = async (
  entry: AdminActionInput,
): Promise<void> => {
  try {
    await AdminActionLogModel.create(entry)
  } catch (err) {
    console.error('audit log write failed', err)
  }
}
