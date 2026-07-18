/**
 * GET /api/health — status endpoint used by the footer health badge,
 * integration tests, and the DO App Platform health check. Always returns
 * 200 so a component outage degrades the report instead of flapping the
 * platform health check; the body carries the real per-service signal
 * (see lib/health).
 */
import { Router } from 'express'
import { getHealth } from '../lib/health'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  res.json(await getHealth())
})
