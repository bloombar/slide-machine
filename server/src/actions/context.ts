/**
 * Execution context passed to every action (SPEC TECH-13). Carries the
 * acting user (once auth lands) and a request id for tracing.
 */
export interface ActionContext {
  userId?: string
  requestId: string
}
