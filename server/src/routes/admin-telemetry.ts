/**
 * Session-telemetry API (SPEC EVAL-1). Mounted inside `adminRouter` after
 * requireAuth + requireAdmin, beside the cost reports it mirrors.
 *
 * Read-only. Rows are append-only and written solely from the live capture
 * path (`telemetry/recorder.ts`); nothing here edits one, and nothing should
 * — the record's value is that it cannot be revised after the fact.
 *
 *   GET /admin/telemetry            deployment-wide session overview
 *   GET /admin/telemetry/decks/:id  one lecture's sessions
 *   GET /admin/telemetry/export     per-session summaries as CSV
 */
import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import type {
  TelemetryDeckResponse,
  TelemetryOverviewResponse,
} from '@slide-machine/shared'
import { HttpError } from '../middleware/error'
import {
  deckTelemetry,
  sessionSummaries,
  telemetryOverview,
} from '../telemetry/session-report'
import { csvRow } from '../audit/csv'
import { SESSION_CSV_COLUMNS, sessionCsvValues } from '../telemetry/session-csv'
import { windowFrom } from './report-window'

export const adminTelemetryRouter = Router()

/** Rejects a path id that is not one, so a typo reads as a bad request rather
 * than as a lecture with no sessions. */
const objectId = (value: unknown, what: string): string => {
  const id = String(value)
  if (!isValidObjectId(id)) {
    throw new HttpError(400, 'invalid_input', `Invalid ${what} id`)
  }
  return id
}

adminTelemetryRouter.get('/telemetry', async (req, res) => {
  const body: TelemetryOverviewResponse = await telemetryOverview(
    windowFrom(req.query as Record<string, unknown>),
  )
  res.json(body)
})

adminTelemetryRouter.get('/telemetry/decks/:id', async (req, res) => {
  const body: TelemetryDeckResponse = await deckTelemetry(
    objectId(req.params.id, 'lecture'),
    windowFrom(req.query as Record<string, unknown>),
  )
  res.json(body)
})

/**
 * Per-session summaries as CSV, newest first — one row per session, not per
 * event, because "did every session leave a healthy record" is the question
 * both the study runbook's weekly check and a later research export (EVAL-2)
 * ask. Assembled in memory rather than streamed: cardinality here is sessions
 * (a handful per lecture), not the event rows underneath them.
 */
adminTelemetryRouter.get('/telemetry/export', async (req, res) => {
  const window = windowFrom(req.query as Record<string, unknown>)
  const sessions = await sessionSummaries({}, window)

  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="session-telemetry-${date}.csv"`,
  )
  res.write(csvRow([...SESSION_CSV_COLUMNS]))
  for (const s of sessions) {
    res.write(csvRow(sessionCsvValues(s)))
  }
  res.end()
})
