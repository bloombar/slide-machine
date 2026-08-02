/**
 * Execution context passed to every action (SPEC TECH-13). Carries the
 * acting user (once auth lands) and a request id for tracing.
 */
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
}
