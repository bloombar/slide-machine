/**
 * Generic action endpoint (SPEC TECH-13): POST /api/actions/:name
 * dispatches the named action with the authenticated user's context.
 * Typed dispatch errors are mapped to statuses by the error middleware.
 */
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { requireAuth } from '../middleware/auth'
import { dispatch } from '../actions/dispatch'
import { appOrigin } from '../lib/app-origin'

export const actionsRouter = Router()

actionsRouter.post('/actions/:name', requireAuth, async (req, res) => {
  const result = await dispatch(String(req.params.name), req.body, {
    userId: req.userId,
    requestId: randomUUID(),
    origin: appOrigin(req),
  })
  res.json(result)
})
