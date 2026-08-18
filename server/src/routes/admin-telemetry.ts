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
  type TelemetryWindow,
} from '../telemetry/session-report'
import { csvRow } from '../audit/csv'

export const adminTelemetryRouter = Router()

/** The window a report covers, from `?from=`/`?to=` ISO dates — same contract
 * as the cost reports: both optional, an unparseable date refused. */
const windowFrom = (query: Record<string, unknown>): TelemetryWindow => {
  const parse = (value: unknown, name: string): Date | undefined => {
    if (value === undefined || value === '') return undefined
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) {
      throw new HttpError(400, 'invalid_input', `Invalid ${name} date`)
    }
    return date
  }
  return { from: parse(query.from, 'from'), to: parse(query.to, 'to') }
}

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
  res.write(
    csvRow([
      'sessionId',
      'deckId',
      'deckName',
      'startedAt',
      'endedAt',
      'wallDurationMs',
      'capturedMs',
      'phraseCount',
      'outcomeNone',
      'outcomeUpdate',
      'outcomeRefit',
      'outcomeNew',
      'outcomeCommand',
      'outcomeDiscarded',
      'finalizationP50Ms',
      'finalizationP95Ms',
      'generationP50Ms',
      'generationP95Ms',
      'refusals',
      'unavailableErrors',
      'otherErrors',
      'sttRestarts',
      'sttErrors',
      'longestGenerationOutageMs',
      'endReason',
      'excluded',
    ]),
  )
  for (const s of sessions) {
    res.write(
      csvRow([
        s.sessionId,
        s.deckId,
        s.deckName,
        s.startedAt,
        s.endedAt,
        s.wallDurationMs,
        s.capturedMs,
        s.phraseCount,
        s.outcomes.none,
        s.outcomes.update,
        s.outcomes.refit,
        s.outcomes.new,
        s.outcomes.command,
        s.outcomes.discarded,
        s.finalization.p50Ms,
        s.finalization.p95Ms,
        s.generation.p50Ms,
        s.generation.p95Ms,
        s.refusals,
        s.providerErrors.unavailable,
        s.providerErrors.other,
        s.sttRestarts,
        s.sttErrors,
        s.longestGenerationOutageMs,
        s.endReason,
        s.excluded,
      ]),
    )
  }
  res.end()
})
