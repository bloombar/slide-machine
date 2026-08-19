/**
 * Research export API (SPEC EVAL-2). Mounted inside `adminRouter` after
 * requireAuth + requireAdmin, beside the cost and telemetry exports whose
 * shape it follows.
 *
 *   GET /admin/research/export   the de-identified bundle as a zip
 *
 * Read-only over the collections it bundles; its one write is assigning a
 * missing study pseudonym, which is set once and never changed.
 */
import { Router } from 'express'
import { buildResearchBundle } from '../research/export-bundle'
import { windowFrom } from './report-window'

export const adminResearchRouter = Router()

adminResearchRouter.get('/research/export', async (req, res) => {
  const window = windowFrom(req.query as Record<string, unknown>)
  const buffer = await buildResearchBundle(window)

  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="research-export-${date}.zip"`,
  )
  res.send(buffer)
})
