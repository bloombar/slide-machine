/**
 * What the machine did during one lecture's live sessions (SPEC EVAL-1).
 *
 * One row per capture session: duration, phrases, latency percentiles,
 * errors, restarts, and how the session ended. The evidence behind "did it
 * work" — a stall the speaker talked over leaves no other trace — and the
 * per-lecture half of the study runbook's weekly record check.
 *
 * A session matching the study protocol's exclusion rule (a generation
 * outage over five minutes, or repeated transcription failures) is marked
 * "excluded" so a bad lecture is flagged where an operator will see it,
 * months before an analysis would have tripped over it.
 */
import { useEffect, useState } from 'react'
import type {
  TelemetryEndReason,
  TelemetrySessionSummary,
} from '@slide-machine/shared'
import { fetchDeckTelemetry } from '../../api/telemetry'

/** A millisecond figure for a table cell: seconds past 10s, else ms. */
export const formatMs = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}

/** A duration for a table cell: h:mm:ss past an hour, else m:ss. */
export const formatDurationMs = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  const totalSeconds = Math.round(value / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const mm = String(minutes).padStart(hours ? 2 : 1, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

const END_LABELS: Record<TelemetryEndReason, string> = {
  stopped: 'Stopped',
  abandoned: 'Abandoned',
  crashed: 'Crashed',
  active: 'Active',
  unknown: 'Unknown',
}

/** Muted for the healthy end, loud for the ones that need a second look. */
const END_STYLES: Record<TelemetryEndReason, string> = {
  stopped: 'bg-slate-100 text-slate-600',
  abandoned: 'bg-amber-100 text-amber-800',
  crashed: 'bg-red-100 text-red-800',
  active: 'bg-emerald-100 text-emerald-800',
  unknown: 'bg-slate-100 text-slate-500',
}

export function EndBadge({ reason }: { reason: TelemetryEndReason }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${END_STYLES[reason]}`}
    >
      {END_LABELS[reason]}
    </span>
  )
}

export function SessionRows({
  sessions,
}: {
  sessions: TelemetrySessionSummary[]
}) {
  return (
    <>
      {sessions.map(s => (
        <tr key={s.sessionId} className="border-t border-slate-100">
          <td className="py-2 whitespace-nowrap">
            {s.startedAt ? new Date(s.startedAt).toLocaleString() : '—'}
          </td>
          <td className="py-2 text-right tabular-nums">
            {formatDurationMs(s.wallDurationMs)}
          </td>
          <td className="py-2 text-right tabular-nums">
            {formatDurationMs(s.capturedMs)}
          </td>
          <td className="py-2 text-right tabular-nums">{s.phraseCount}</td>
          <td className="py-2 text-right tabular-nums whitespace-nowrap">
            {formatMs(s.finalization.p50Ms)} / {formatMs(s.finalization.p95Ms)}
          </td>
          <td className="py-2 text-right tabular-nums whitespace-nowrap">
            {formatMs(s.generation.p50Ms)} / {formatMs(s.generation.p95Ms)}
          </td>
          <td className="py-2 text-right tabular-nums">
            {s.providerErrors.unavailable +
              s.providerErrors.other +
              s.sttErrors}
          </td>
          <td className="py-2 text-right tabular-nums">{s.sttRestarts}</td>
          <td className="py-2 pl-3 whitespace-nowrap">
            <EndBadge reason={s.endReason} />
            {s.excluded && (
              <span
                title="Matches the study's exclusion rule: a generation outage over 5 minutes or repeated transcription failures."
                className="ml-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
              >
                excluded
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}

/** Column headers shared with the admin telemetry overview page. */
export function SessionHeaders() {
  return (
    <tr>
      <th scope="col" className="py-2">
        Started
      </th>
      <th scope="col" className="py-2 text-right">
        Duration
      </th>
      <th scope="col" className="py-2 text-right">
        Captured
      </th>
      <th scope="col" className="py-2 text-right">
        Phrases
      </th>
      <th scope="col" className="py-2 text-right">
        STT p50/p95
      </th>
      <th scope="col" className="py-2 text-right">
        Gen. p50/p95
      </th>
      <th scope="col" className="py-2 text-right">
        Errors
      </th>
      <th scope="col" className="py-2 text-right">
        Restarts
      </th>
      <th scope="col" className="py-2 pl-3">
        Ended
      </th>
    </tr>
  )
}

/** What has been loaded, tagged with the deck it belongs to — tagging rather
 * than clearing on change, same reasoning as CostPanel. */
interface Loaded {
  key: string
  sessions: TelemetrySessionSummary[] | null
  failed: boolean
}

export default function TelemetryPanel({ deckId }: { deckId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let live = true
    fetchDeckTelemetry(deckId)
      .then(
        body =>
          live &&
          setLoaded({ key: deckId, sessions: body.sessions, failed: false }),
      )
      .catch(
        () => live && setLoaded({ key: deckId, sessions: null, failed: true }),
      )
    return () => {
      live = false
    }
  }, [deckId])

  const current = loaded?.key === deckId ? loaded : null
  const sessions = current?.sessions ?? null
  const failed = current?.failed ?? false

  return (
    <section
      data-testid="telemetry-panel"
      className="mt-8 rounded-lg border border-slate-200 p-4"
    >
      <h2 className="mb-3 text-lg font-semibold text-slate-700">Sessions</h2>
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          Could not load sessions.
        </p>
      ) : !sessions ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !sessions.length ? (
        <p className="text-sm text-slate-500">No live sessions recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase">
              <SessionHeaders />
            </thead>
            <tbody>
              <SessionRows sessions={sessions} />
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
