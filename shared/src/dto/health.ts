/**
 * DTO for GET /api/health — the walking-skeleton endpoint used by the
 * client status page, integration tests, and deployment health checks.
 */
export interface HealthResponse {
  status: 'ok' | 'degraded'
  mongo: 'connected' | 'disconnected'
  /** Server process uptime in seconds. */
  uptime: number
  version: string
}
