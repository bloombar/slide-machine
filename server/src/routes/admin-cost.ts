/**
 * Cost reporting API (SPEC BILL-7). Mounted inside `adminRouter` after
 * requireAuth + requireAdmin, so the allowlist gate covers it — the ledger
 * spans every account, and what a deployment spends on whom is an operator's
 * business rather than a user's.
 *
 * Read-only, like the audit logs it sits beside. The ledger is append-only and
 * written solely from the metering path (`billing/cost-ledger.ts`); nothing
 * here edits or deletes a row, and nothing should. Bounding its growth is the
 * retention sweep's job (`jobs/cost-rollup.ts`), not an endpoint's.
 *
 *   GET /admin/cost                     deployment-wide overview
 *   GET /admin/cost/users/:id           one account's spend
 *   GET /admin/cost/projects/:id        one project's spend
 *   GET /admin/cost/decks/:id           one lecture's spend
 *   GET /admin/cost/export              the raw ledger as CSV
 */
import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import type {
  CostOverviewResponse,
  CostSummaryResponse,
} from '@slide-machine/shared'
import { HttpError } from '../middleware/error'
import { CostEventModel } from '../models/cost-event'
import {
  costOverview,
  costSummary,
  type CostWindow,
} from '../billing/cost-report'
import { MICROS_PER_UNIT } from '../billing/pricing'
import { periodStartFor } from '../billing/usage'
import { csvRow } from '../audit/csv'
import { windowFrom, windowFilter } from './report-window'
import { loadAnyDeck, loadAnyProject } from './admin-targets'

export const adminCostRouter = Router()

/** Rejects a path id that is not one, so a typo reads as a bad request rather
 * than as an entity that spent nothing. */
const objectId = (value: unknown, what: string): string => {
  const id = String(value)
  if (!isValidObjectId(id)) {
    throw new HttpError(400, 'invalid_input', `Invalid ${what} id`)
  }
  return id
}

adminCostRouter.get('/cost', async (req, res) => {
  const body: CostOverviewResponse = await costOverview(
    windowFrom(req.query as Record<string, unknown>),
  )
  res.json(body)
})

/**
 * The window a scoped summary was asked for. `?window=period` resolves the
 * payer's current billing period — the user's own on a user scope, the
 * owner's on a project or lecture scope, since every ledger row there is
 * charged to the owner anyway. `?window=all` is the whole ledger, and the raw
 * `?from=`/`?to=` pair stays for ad-hoc spans; a named window wins over it.
 */
const resolveWindow = async (
  query: Record<string, unknown>,
  ownerId: () => Promise<string>,
): Promise<CostWindow> => {
  const named = query.window
  if (named === undefined) return windowFrom(query)
  if (named === 'all') return {}
  if (named === 'period') return { from: await periodStartFor(await ownerId()) }
  throw new HttpError(400, 'invalid_input', 'Invalid cost window')
}

/** One scope's summary, stamped with the window it actually covered so the
 * client never re-derives period boundaries the server already knows. */
const windowedSummary = async (
  scope: { payerId?: string; deckId?: string; projectId?: string },
  ownerId: () => Promise<string>,
  query: Record<string, unknown>,
): Promise<CostSummaryResponse> => {
  const window = await resolveWindow(query, ownerId)
  const summary = await costSummary(scope, window)
  return {
    ...summary,
    window: {
      from: window.from?.toISOString() ?? null,
      to: window.to?.toISOString() ?? null,
    },
  }
}

adminCostRouter.get('/cost/users/:id', async (req, res) => {
  const payerId = objectId(req.params.id, 'user')
  const body = await windowedSummary(
    { payerId },
    async () => payerId,
    req.query as Record<string, unknown>,
  )
  res.json(body)
})

adminCostRouter.get('/cost/projects/:id', async (req, res) => {
  const projectId = objectId(req.params.id, 'project')
  const body = await windowedSummary(
    { projectId },
    async () => (await loadAnyProject(projectId)).ownerId.toString(),
    req.query as Record<string, unknown>,
  )
  res.json(body)
})

adminCostRouter.get('/cost/decks/:id', async (req, res) => {
  const deckId = objectId(req.params.id, 'lecture')
  const body = await windowedSummary(
    { deckId },
    async () => (await loadAnyDeck(deckId)).ownerId.toString(),
    req.query as Record<string, unknown>,
  )
  res.json(body)
})

/**
 * The ledger as CSV, newest first — the same shape as the other admin exports.
 *
 * Streamed through a cursor rather than assembled in memory: this is the one
 * collection in the product that grows with *usage* rather than with content,
 * and a deployment a year in has far more rows than an operator's browser
 * wants to wait for in one buffer.
 *
 * Costs are written in currency units rather than micros. Micros are how the
 * ledger stays exact; a spreadsheet wants money.
 */
adminCostRouter.get('/cost/export', async (req, res) => {
  const window = windowFrom(req.query as Record<string, unknown>)
  const filter = windowFilter('occurredAt', window)

  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="cost-ledger-${date}.csv"`,
  )
  res.write(
    csvRow([
      'occurredAt',
      'payerId',
      'actorId',
      'actorKind',
      'projectId',
      'projectName',
      'deckId',
      'deckName',
      'metric',
      'quantity',
      'billable',
      'cost',
      'currency',
    ]),
  )
  const cursor = CostEventModel.find(filter).sort({ occurredAt: -1 }).cursor()
  for await (const doc of cursor) {
    res.write(
      csvRow([
        doc.occurredAt.toISOString(),
        doc.payerId.toString(),
        // Blank for an anonymous viewer, which is the honest rendering: there
        // is no identity here, not a withheld one (§16).
        doc.actorId?.toString(),
        doc.actorKind,
        doc.projectId?.toString(),
        doc.projectName,
        doc.deckId?.toString(),
        doc.deckName,
        doc.metric,
        doc.quantity,
        doc.billable,
        (doc.costMicros / MICROS_PER_UNIT).toFixed(6),
        doc.currency,
      ]),
    )
  }
  res.end()
})
