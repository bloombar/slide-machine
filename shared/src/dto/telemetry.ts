/**
 * Session-telemetry DTOs (SPEC EVAL-1) — the admin-facing summary of what the
 * machine did during one live capture session. Summaries are derived at read
 * time from append-only telemetry event rows; nothing here carries student
 * identity, transcript text, or slide content.
 */

/**
 * How a session ended. `stopped` and `abandoned` are written by the server at
 * session end; the rest are derived at read time: `crashed` when a started
 * session has no end record and has gone quiet, `active` when it has no end
 * record but recent events, and `unknown` for browser-engine sessions, which
 * open no server socket and so have no observable end.
 */
export type TelemetryEndReason =
  'stopped' | 'abandoned' | 'crashed' | 'active' | 'unknown'

/** Latency percentiles over one session's samples; null when no samples. */
export interface LatencyStats {
  count: number
  p50Ms: number | null
  p95Ms: number | null
}

/** One live session's derived telemetry summary. */
export interface TelemetrySessionSummary {
  sessionId: string
  /** Null when the session named no lecture or the socket's user could not edit it. */
  deckId: string | null
  /** Denormalized at read time; soft-deleted lectures still resolve. */
  deckName?: string
  /** ISO timestamps; null when the session left no start/end record. */
  startedAt: string | null
  endedAt: string | null
  wallDurationMs: number | null
  /** Milliseconds of audio actually captured; null when unknowable. */
  capturedMs: number | null
  phraseCount: number
  /** Per-phrase outcomes, from the same classification the transcript stores. */
  outcomes: {
    none: number
    update: number
    refit: number
    new: number
    command: number
    discarded: number
  }
  /** Phrase-finalization latency (speech end → final transcript). */
  finalization: LatencyStats
  /** Slide-generation latency (the model call, including internal re-asks). */
  generation: LatencyStats
  /** Specialized-content re-asks — the model answered prose where code/math belonged. */
  refusals: number
  providerErrors: { unavailable: number; other: number }
  sttRestarts: number
  sttErrors: number
  /** Longest span from a generation error to the next successful phrase; null when no errors. */
  longestGenerationOutageMs: number | null
  /**
   * The study protocol's exclusion rule (§7.5), precomputed: a generation
   * outage over 5 consecutive minutes or more than one transcription error.
   * The raw fields above let the rule be recomputed independently.
   */
  excluded: boolean
  endReason: TelemetryEndReason
}

/** Deployment-wide telemetry for a date window (admin overview page). */
export interface TelemetryOverviewResponse {
  window: { from: string | null; to: string | null }
  totals: {
    sessions: number
    stopped: number
    abandoned: number
    crashed: number
    active: number
    unknown: number
    excludable: number
  }
  sessions: TelemetrySessionSummary[]
}

/** One lecture's sessions (admin lecture-detail panel). */
export interface TelemetryDeckResponse {
  sessions: TelemetrySessionSummary[]
}
