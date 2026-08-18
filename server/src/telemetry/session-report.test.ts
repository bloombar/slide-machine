/**
 * Unit tests for the pure telemetry fold (SPEC EVAL-1): percentiles, the
 * end-reason derivation matrix, captured-duration fallback, outage spans,
 * and the study's exclusion rule. No database — that is the point of the
 * fold being pure.
 */
import { describe, expect, it } from 'vitest'
import type { SessionTelemetryEventDb } from '../models/session-telemetry-event'
import {
  ACTIVE_WINDOW_MS,
  percentile,
  summarizeSession,
} from './session-report'

const T0 = new Date('2026-09-14T12:30:00Z')
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs)

/** A row with only what the fold reads; deckId omitted unless a test sets it. */
const row = (
  kind: SessionTelemetryEventDb['kind'],
  offsetMs: number,
  fields: Partial<SessionTelemetryEventDb> = {},
): SessionTelemetryEventDb =>
  ({
    sessionId: 'sess-1',
    kind,
    at: at(offsetMs),
    ...fields,
  }) as SessionTelemetryEventDb

/** A `now` far past the active window, so unended sessions read as crashed. */
const LATER = at(ACTIVE_WINDOW_MS * 10)

describe('percentile', () => {
  it('returns null for an empty sample', () => {
    expect(percentile([], 50)).toBeNull()
  })

  it('returns the single element at any rank', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
  })

  it('computes nearest-rank p50 and p95 on a known array', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    // Nearest-rank: p50 → ceil(0.5·10)=5th → 50; p95 → ceil(0.95·10)=10th → 100.
    expect(percentile(sorted, 50)).toBe(50)
    expect(percentile(sorted, 95)).toBe(100)
  })
})

describe('summarizeSession end reasons', () => {
  it('reads a session_end row as its stored reason', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0, { engine: 'google-cloud' }),
        row('session_end', 60_000, {
          endReason: 'stopped',
          capturedMs: 55_000,
        }),
      ],
      LATER,
    )
    expect(summary.endReason).toBe('stopped')
    expect(summary.startedAt).toBe(at(0).toISOString())
    expect(summary.endedAt).toBe(at(60_000).toISOString())
    expect(summary.wallDurationMs).toBe(60_000)
    expect(summary.capturedMs).toBe(55_000)
  })

  it('derives crashed for a started session with no end row, gone quiet', () => {
    const summary = summarizeSession(
      [row('session_start', 0), row('phrase', 30_000, { outcome: 'new' })],
      LATER,
    )
    expect(summary.endReason).toBe('crashed')
  })

  it('derives active for a started session with recent events', () => {
    const summary = summarizeSession(
      [row('session_start', 0), row('phrase', 30_000, { outcome: 'new' })],
      at(30_000 + ACTIVE_WINDOW_MS - 1),
    )
    expect(summary.endReason).toBe('active')
  })

  it('derives unknown for a browser-engine session (phrase rows only)', () => {
    const summary = summarizeSession(
      [row('phrase', 0, { outcome: 'new', generationMs: 900 })],
      LATER,
    )
    expect(summary.endReason).toBe('unknown')
    expect(summary.wallDurationMs).toBe(0)
  })

  it('keeps an abandoned end distinct from a crash', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0),
        row('session_end', 5_000, { endReason: 'abandoned' }),
      ],
      LATER,
    )
    expect(summary.endReason).toBe('abandoned')
  })
})

describe('summarizeSession folding', () => {
  it('falls back to the deepest stt_final audio offset for capturedMs', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0),
        row('stt_final', 10_000, { finalizationMs: 400, audioMs: 9_000 }),
        row('stt_final', 20_000, { finalizationMs: 600, audioMs: 19_000 }),
      ],
      LATER,
    )
    // No end row (crash): captured audio is known only from the finals.
    expect(summary.capturedMs).toBe(19_000)
    expect(summary.finalization).toEqual({ count: 2, p50Ms: 400, p95Ms: 600 })
  })

  it('tallies outcomes, refusals, latencies, restarts and errors', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0),
        row('phrase', 1_000, { outcome: 'new', generationMs: 800 }),
        row('phrase', 2_000, {
          outcome: 'update',
          generationMs: 1_200,
          refusals: 2,
        }),
        row('phrase', 3_000, { outcome: 'none', generationMs: 400 }),
        row('phrase', 4_000, { outcome: 'discarded', generationMs: 1_000 }),
        row('stt_restart', 5_000, { restartReason: 'timer' }),
        row('stt_error', 6_000, { errorMessage: 'stream died' }),
        row('generation_error', 7_000, { errorKind: 'unavailable' }),
        row('generation_error', 8_000, { errorKind: 'error' }),
        row('session_end', 9_000, { endReason: 'stopped', capturedMs: 8_500 }),
      ],
      LATER,
    )
    expect(summary.phraseCount).toBe(4)
    expect(summary.outcomes).toEqual({
      none: 1,
      update: 1,
      refit: 0,
      new: 1,
      command: 0,
      discarded: 1,
    })
    expect(summary.refusals).toBe(2)
    expect(summary.generation.count).toBe(4)
    expect(summary.providerErrors).toEqual({ unavailable: 1, other: 1 })
    expect(summary.sttRestarts).toBe(1)
    expect(summary.sttErrors).toBe(1)
  })
})

describe('outage spans and the exclusion rule', () => {
  it('measures an outage from the first error to the next phrase', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0),
        row('phrase', 1_000, { outcome: 'new', generationMs: 500 }),
        row('generation_error', 2_000, { errorKind: 'error' }),
        row('generation_error', 60_000, { errorKind: 'error' }),
        row('phrase', 122_000, { outcome: 'new', generationMs: 700 }),
        row('session_end', 200_000, { endReason: 'stopped' }),
      ],
      LATER,
    )
    // Opened at 2s, closed by the phrase at 122s — 120s, under the 5-min bar.
    expect(summary.longestGenerationOutageMs).toBe(120_000)
    expect(summary.excluded).toBe(false)
  })

  it('runs an unclosed outage to the last row and applies the 5-minute bar', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0),
        row('generation_error', 10_000, { errorKind: 'unavailable' }),
        row('session_end', 320_000, { endReason: 'stopped' }),
      ],
      LATER,
    )
    // 10s → 320s is 310s — over the 300s bar.
    expect(summary.longestGenerationOutageMs).toBe(310_000)
    expect(summary.excluded).toBe(true)
  })

  it('reports no outage when no generation error occurred', () => {
    const summary = summarizeSession(
      [
        row('session_start', 0),
        row('phrase', 1_000, { outcome: 'new', generationMs: 500 }),
        row('session_end', 2_000, { endReason: 'stopped' }),
      ],
      LATER,
    )
    expect(summary.longestGenerationOutageMs).toBeNull()
    expect(summary.excluded).toBe(false)
  })

  it('excludes on repeated stt errors but tolerates a single one', () => {
    const base = [
      row('session_start', 0),
      row('session_end', 1_000, { endReason: 'stopped' }),
    ]
    expect(
      summarizeSession([...base, row('stt_error', 500)], LATER).excluded,
    ).toBe(false)
    expect(
      summarizeSession(
        [...base, row('stt_error', 400), row('stt_error', 600)],
        LATER,
      ).excluded,
    ).toBe(true)
  })
})
