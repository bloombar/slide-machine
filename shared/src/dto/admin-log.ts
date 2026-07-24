/**
 * DTOs for the admin audit log (GET /api/admin/logs and its CSV export).
 * Every admin action that changes or exposes user data is recorded as an
 * append-only AdminLogEntry; see docs/ADMINISTRATION.md ("Audit log").
 */

/**
 * A namespaced admin action name in `noun.verb` form, e.g. `user.delete`,
 * `user.ban`, `deck.delete`, `slide.private_view`. The template type
 * enforces the namespacing at compile time while leaving the vocabulary
 * open — new admin features just pass a new literal. Once a handful of
 * real actions exist, this can tighten into a const-array union that
 * doubles as a canonical registry.
 */
export type AdminAction = `${string}.${string}`

/** One append-only audit record of an admin acting on app data. */
export interface AdminLogEntry {
  id: string
  /** The acting admin's user id. */
  actorId: string
  /** The acting admin's email, snapshotted at the time of the action. */
  actorEmail: string
  /** Namespaced action name; open string on the wire so historic entries
   * survive vocabulary changes (writes are typed as AdminAction). */
  action: string
  /** Kind of resource acted on, e.g. 'user', 'project', 'deck'. */
  targetType?: string
  /** Id of the resource acted on. */
  targetId?: string
  /** Small, action-specific context (kept JSON-serializable). */
  details?: Record<string, unknown>
  /** ISO timestamp of when the action happened. */
  createdAt: string
}

export interface AdminLogsResponse {
  logs: AdminLogEntry[]
  total: number
  page: number
  limit: number
}
