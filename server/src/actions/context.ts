/**
 * Execution context passed to every action (SPEC TECH-13). Carries the
 * acting user (once auth lands) and a request id for tracing.
 */
import type { ActorChannel } from '@slide-machine/shared'

export interface ActionContext {
  userId?: string
  requestId: string
  /**
   * Absolute origin the app is reached at, for actions that must hand an
   * outside service somewhere to send the browser back to — billing checkout
   * and the hosted portal (BILL-2). Server-derived, never taken from a
   * client-supplied header, so a return URL cannot be pointed elsewhere.
   * Absent outside HTTP (seeding, background work), where nothing redirects.
   */
  origin?: string
  /**
   * How this call reached the application — the app's own front end, or an
   * external AI assistant over MCP (docs/MCP.md §6).
   *
   * Absent means `app`. Only the MCP endpoint sets anything else, and it is
   * the one path where the distinction is not recoverable from anything else
   * on the request: an agent's calls are ordinary calls by the account that
   * authorized them, and are meant to be.
   */
  channel?: ActorChannel
}
