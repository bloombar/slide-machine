/**
 * GET /api/health — liveness endpoint used by the client status page,
 * integration tests, and the DO App Platform health check. Always returns
 * 200 so a Mongo outage degrades the report instead of flapping the
 * platform health check; `status` carries the real signal.
 */
import { Router } from 'express'
import type { HealthResponse } from '@slide-machine/shared'
import { pingMongo } from '../db/mongoose'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const mongoUp = await pingMongo()
  const body: HealthResponse = {
    status: mongoUp ? 'ok' : 'degraded',
    mongo: mongoUp ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '0.0.0',
  }
  res.json(body)
})
