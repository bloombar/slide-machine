/**
 * The append-only live-session telemetry log (SPEC EVAL-1).
 *
 * One row per thing the machine did during a live capture session: the
 * session starting, a phrase finalizing, a slide generating (or failing to),
 * the transcription stream restarting, the session ending. Per-session
 * summaries — latency percentiles, error counts, end state — are derived at
 * read time by folding a session's rows in order.
 *
 * Rows are events rather than one summary per session because the record has
 * to survive the failures it exists to describe: a summary written at session
 * end is lost precisely when the session crashes, while with event rows a
 * crash is simply the absence of a `session_end` row. Each row is written
 * once and never updated.
 *
 * What a row deliberately does not carry:
 *
 * - **No student identity, and no user identity at all.** The study protocol
 *   (P-7/P-14) requires evaluation data to be free of identity; the machine's
 *   performance is nobody's personal data.
 * - **No transcript text or slide content.** `errorMessage` holds provider
 *   operational text only, trimmed, never speech.
 *
 * Definitions the counters rely on:
 *
 * - A **refusal** is one specialized code/math slot the generation model
 *   answered in prose and was re-asked for (`refusedSpecialized`).
 * - `generation_error` kind `unavailable` is a provider quota/overload error
 *   (`GenerationUnavailableError`); `error` is any other generation failure.
 * - `endReason` only ever stores `stopped` (the client sent a deliberate stop)
 *   or `abandoned` (the socket closed without one). `crashed` is never
 *   written — it is derived at read time from a started session with no end
 *   row, which is the one classification a crashing process cannot record.
 *
 * Only the google-cloud engine opens the audio socket, so only it writes
 * lifecycle rows. Browser-engine sessions leave `phrase` rows alone and read
 * back with end reason `unknown`; typed Speak-bar input carries no session id
 * and writes nothing. The pilot study runs on google-cloud.
 *
 * Like the cost ledger, deliberately no soft-delete plugin and no cascade
 * participation: a deleted lecture's session still happened, and telemetry
 * that disappears with the thing it describes cannot answer "did it work".
 */
import { Schema, type Types } from 'mongoose'
import { defineModel } from './define-model'

export const TELEMETRY_KINDS = [
  'session_start',
  'stt_final',
  'phrase',
  'generation_error',
  'stt_restart',
  'stt_error',
  'session_end',
] as const

export type TelemetryKind = (typeof TELEMETRY_KINDS)[number]

/** Per-phrase outcome — the transcript's own classification, plus `command`
 * for voice commands and `discarded` for a generated-then-rejected refit. */
export const TELEMETRY_OUTCOMES = [
  'none',
  'update',
  'refit',
  'new',
  'command',
  'discarded',
] as const

export type TelemetryOutcome = (typeof TELEMETRY_OUTCOMES)[number]

export interface SessionTelemetryEventDb {
  /** Client-minted capture-session id; one id spans one recording. */
  sessionId: string
  /**
   * The lecture, when the session named one the connecting user may edit.
   * Null otherwise — a socket naming someone else's deck must not be able to
   * write telemetry into it.
   */
  deckId?: Types.ObjectId | null
  kind: TelemetryKind
  /** Server wall clock at write. */
  at: Date
  // session_start
  /** Only the socket-based engine writes lifecycle rows. */
  engine?: string
  languageCode?: string
  sampleRate?: number
  // stt_final
  /** Speech end → final transcript, in wall-clock ms. */
  finalizationMs?: number
  /** The final's last word-end offset — audio time consumed so far. Doubles
   * as the captured-duration fallback when a crash loses the end row. */
  audioMs?: number
  // phrase
  outcome?: TelemetryOutcome
  /** The generation model call, including internal re-asks. Absent when the
   * paused fast-path skipped the model entirely. */
  generationMs?: number
  refusals?: number
  // generation_error
  errorKind?: 'unavailable' | 'error'
  retryable?: boolean
  // generation_error / stt_error
  /** Provider operational text, trimmed to 200 chars. Never speech. */
  errorMessage?: string
  // stt_restart
  restartReason?: 'timer' | 'out_of_range'
  // session_end
  endReason?: 'stopped' | 'abandoned'
  /** Milliseconds of audio captured, from the socket's byte count. */
  capturedMs?: number
}

const sessionTelemetryEventSchema = new Schema<SessionTelemetryEventDb>({
  sessionId: { type: String, required: true },
  deckId: { type: Schema.Types.ObjectId, ref: 'Deck', default: null },
  kind: { type: String, enum: TELEMETRY_KINDS, required: true },
  at: { type: Date, required: true, default: Date.now },
  engine: String,
  languageCode: String,
  sampleRate: Number,
  finalizationMs: Number,
  audioMs: Number,
  outcome: { type: String, enum: TELEMETRY_OUTCOMES },
  generationMs: Number,
  refusals: Number,
  errorKind: { type: String, enum: ['unavailable', 'error'] },
  retryable: Boolean,
  errorMessage: String,
  restartReason: { type: String, enum: ['timer', 'out_of_range'] },
  endReason: { type: String, enum: ['stopped', 'abandoned'] },
  capturedMs: Number,
})

// The admin lecture panel reads one deck's sessions over a window.
sessionTelemetryEventSchema.index({ deckId: 1, at: -1 })
// A session's summary folds its rows in write order.
sessionTelemetryEventSchema.index({ sessionId: 1, at: 1 })
// The deployment-wide overview and export walk by time alone.
sessionTelemetryEventSchema.index({ at: -1 })

// defineModel because rows are written from inside the action pipeline
// (session.phrase) and from module graphs the socket specs re-evaluate.
export const SessionTelemetryEventModel = defineModel<SessionTelemetryEventDb>(
  'SessionTelemetryEvent',
  sessionTelemetryEventSchema,
)
