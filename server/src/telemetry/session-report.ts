/**
 * Session-telemetry reporting (SPEC EVAL-1) — folds a session's append-only
 * event rows into the summary the admin views and the CSV export serve.
 *
 * Derivation at read time is the point, not an optimization: percentiles,
 * outage spans, and above all the end state cannot be written by a process
 * that crashed. A started session with no end row *is* the crash record.
 *
 * The fold is pure and exported so it unit-tests without a database.
 */
import { Types } from 'mongoose'
import type {
  LatencyStats,
  TelemetryDeckResponse,
  TelemetryEndReason,
  TelemetryOverviewResponse,
  TelemetrySessionSummary,
} from '@slide-machine/shared'
import {
  SessionTelemetryEventModel,
  type SessionTelemetryEventDb,
} from '../models/session-telemetry-event'
import { DeckModel } from '../models/deck'
import { withDeleted } from '../lib/admin-view'

export interface TelemetryWindow {
  from?: Date
  to?: Date
}

/** A session with no end row whose last event is older than this reads as
 * crashed; younger, as still active. Half an hour: no honest gap between
 * telemetry rows in a live lecture approaches it. */
export const ACTIVE_WINDOW_MS = 30 * 60_000

/** The study protocol's exclusion thresholds (§7.5): a generation outage over
 * five consecutive minutes, or more than one transcription failure. */
const OUTAGE_EXCLUSION_MS = 5 * 60_000
const STT_ERROR_EXCLUSION_COUNT = 1

/** Nearest-rank percentile of an ASCENDING-sorted sample; null when empty. */
export const percentile = (sorted: number[], p: number): number | null => {
  if (!sorted.length) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!
}

const latencyStats = (samples: number[]): LatencyStats => {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  }
}

/**
 * Folds one session's rows (ordered by write time) into its summary.
 * `now` is passed in rather than read so the active/crashed boundary is
 * testable and stable across one report.
 */
export const summarizeSession = (
  rows: SessionTelemetryEventDb[],
  now: Date,
): TelemetrySessionSummary => {
  const first = rows[0]
  const last = rows[rows.length - 1]
  const start = rows.find(r => r.kind === 'session_start')
  const end = rows.find(r => r.kind === 'session_end')

  const outcomes = {
    none: 0,
    update: 0,
    refit: 0,
    new: 0,
    command: 0,
    discarded: 0,
  }
  const finalizationSamples: number[] = []
  const generationSamples: number[] = []
  let refusals = 0
  let unavailable = 0
  let otherErrors = 0
  let sttRestarts = 0
  let sttErrors = 0
  let maxAudioMs: number | null = null

  // A generation outage runs from an error row to the next successful phrase
  // (or, still open, to the session's last row) — the span the study's
  // exclusion rule (§7.5) is written against.
  let outageOpenedAt: Date | null = null
  let longestOutageMs: number | null = null
  const closeOutage = (at: Date): void => {
    if (!outageOpenedAt) return
    const span = at.getTime() - outageOpenedAt.getTime()
    if (longestOutageMs === null || span > longestOutageMs)
      longestOutageMs = span
    outageOpenedAt = null
  }

  for (const row of rows) {
    switch (row.kind) {
      case 'stt_final':
        if (typeof row.finalizationMs === 'number')
          finalizationSamples.push(row.finalizationMs)
        if (typeof row.audioMs === 'number')
          maxAudioMs = Math.max(maxAudioMs ?? 0, row.audioMs)
        break
      case 'phrase':
        if (row.outcome) outcomes[row.outcome] += 1
        if (typeof row.generationMs === 'number')
          generationSamples.push(row.generationMs)
        refusals += row.refusals ?? 0
        closeOutage(row.at)
        break
      case 'generation_error':
        if (row.errorKind === 'unavailable') unavailable += 1
        else otherErrors += 1
        outageOpenedAt ??= row.at
        break
      case 'stt_restart':
        sttRestarts += 1
        break
      case 'stt_error':
        sttErrors += 1
        break
      default:
        break
    }
  }
  // An outage never closed by a later phrase ran to the end of the record.
  if (outageOpenedAt && last) closeOutage(last.at)

  const phraseCount = rows.filter(r => r.kind === 'phrase').length

  let endReason: TelemetryEndReason
  if (end?.endReason) endReason = end.endReason
  else if (!start) endReason = 'unknown'
  else if (last && now.getTime() - last.at.getTime() < ACTIVE_WINDOW_MS)
    endReason = 'active'
  else endReason = 'crashed'

  const startedAt = start?.at ?? first?.at ?? null
  const endedAt = end?.at ?? null

  return {
    sessionId: first?.sessionId ?? '',
    deckId: rows.find(r => r.deckId)?.deckId?.toString() ?? null,
    startedAt: startedAt ? startedAt.toISOString() : null,
    endedAt: endedAt ? endedAt.toISOString() : null,
    wallDurationMs:
      startedAt && last ? last.at.getTime() - startedAt.getTime() : null,
    capturedMs: end?.capturedMs ?? maxAudioMs,
    phraseCount,
    outcomes,
    finalization: latencyStats(finalizationSamples),
    generation: latencyStats(generationSamples),
    refusals,
    providerErrors: { unavailable, other: otherErrors },
    sttRestarts,
    sttErrors,
    longestGenerationOutageMs: longestOutageMs,
    excluded:
      (longestOutageMs ?? 0) > OUTAGE_EXCLUSION_MS ||
      sttErrors > STT_ERROR_EXCLUSION_COUNT,
    endReason,
  }
}

/**
 * Summaries for every session with an event in the window (and, optionally,
 * on one lecture), newest first. Sessions are fetched whole even when they
 * span the window's edge — truncating one would misreport its latencies and
 * misclassify its end.
 */
export const sessionSummaries = async (
  scope: { deckId?: string },
  window: TelemetryWindow,
): Promise<TelemetrySessionSummary[]> => {
  const match: Record<string, unknown> = {}
  if (scope.deckId) match.deckId = new Types.ObjectId(scope.deckId)
  if (window.from || window.to) {
    match.at = {
      ...(window.from ? { $gte: window.from } : {}),
      ...(window.to ? { $lte: window.to } : {}),
    }
  }
  const sessionIds = await SessionTelemetryEventModel.distinct(
    'sessionId',
    match,
  )
  if (!sessionIds.length) return []

  const rows = await SessionTelemetryEventModel.find({
    sessionId: { $in: sessionIds },
    ...(scope.deckId ? { deckId: new Types.ObjectId(scope.deckId) } : {}),
  }).sort({ sessionId: 1, at: 1, _id: 1 })

  const bySession = new Map<string, SessionTelemetryEventDb[]>()
  for (const row of rows) {
    const group = bySession.get(row.sessionId)
    if (group) group.push(row)
    else bySession.set(row.sessionId, [row])
  }

  const now = new Date()
  const summaries = [...bySession.values()].map(group =>
    summarizeSession(group, now),
  )

  // Lecture titles denormalized at read time; a soft-deleted lecture's
  // session still happened, so its title still resolves.
  const deckIds = [
    ...new Set(summaries.map(s => s.deckId).filter((id): id is string => !!id)),
  ]
  if (deckIds.length) {
    const decks = await DeckModel.find({ _id: { $in: deckIds } })
      .select('title')
      .setOptions(withDeleted)
    const titles = new Map(decks.map(d => [d._id.toString(), d.title]))
    for (const summary of summaries) {
      const title = summary.deckId ? titles.get(summary.deckId) : undefined
      if (title) summary.deckName = title
    }
  }

  return summaries.sort((a, b) =>
    (b.startedAt ?? '').localeCompare(a.startedAt ?? ''),
  )
}

/** The deployment-wide overview: totals over the window plus every session. */
export const telemetryOverview = async (
  window: TelemetryWindow,
): Promise<TelemetryOverviewResponse> => {
  const sessions = await sessionSummaries({}, window)
  const totals = {
    sessions: sessions.length,
    stopped: 0,
    abandoned: 0,
    crashed: 0,
    active: 0,
    unknown: 0,
    excludable: 0,
  }
  for (const session of sessions) {
    totals[session.endReason] += 1
    if (session.excluded) totals.excludable += 1
  }
  return {
    window: {
      from: window.from?.toISOString() ?? null,
      to: window.to?.toISOString() ?? null,
    },
    totals,
    sessions,
  }
}

/** One lecture's sessions (the admin lecture panel). */
export const deckTelemetry = async (
  deckId: string,
  window: TelemetryWindow,
): Promise<TelemetryDeckResponse> => ({
  sessions: await sessionSummaries({ deckId }, window),
})
