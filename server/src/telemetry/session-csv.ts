/**
 * The CSV shape of one per-session telemetry summary, shared by the admin
 * telemetry export (EVAL-1) and the research bundle (EVAL-2) so the two
 * never drift: a column added for the study is a column the weekly check
 * sees too, and vice versa.
 */
import type { TelemetrySessionSummary } from '@slide-machine/shared'

/** Header row, one name per column of `sessionCsvValues`. */
export const SESSION_CSV_COLUMNS = [
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
] as const

/** One summary flattened into that column order. */
export const sessionCsvValues = (s: TelemetrySessionSummary): unknown[] => [
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
]
