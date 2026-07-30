/**
 * Unit tests for the PCM capture worklet's downsampling (CAP-3). The worklet
 * normally runs inside an AudioWorkletGlobalScope, so these tests stub that
 * scope's globals, capture the class it registers, and drive `process()`
 * directly — exercising the real shipped file rather than a copy of its math.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

interface Processor {
  process(inputs: Float32Array[][]): boolean
  port: { postMessage: (data: ArrayBuffer, transfer?: ArrayBuffer[]) => void }
  /** Samples buffered but not yet posted — needed to count exact output. */
  offset: number
}
type ProcessorCtor = new (options?: {
  processorOptions?: Record<string, number>
}) => Processor

let PcmProcessor: ProcessorCtor

beforeAll(async () => {
  class FakeAudioWorkletProcessor {
    port = { postMessage: () => {} }
  }
  let registered: ProcessorCtor | undefined
  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor)
  vi.stubGlobal('registerProcessor', (_name: string, ctor: ProcessorCtor) => {
    registered = ctor
  })
  // The scope global the worklet falls back to when given no input rate.
  vi.stubGlobal('sampleRate', 48_000)
  // Plain JS with no exports — it runs in an AudioWorkletGlobalScope rather
  // than through the app's TS build, and this import exists only for the
  // registerProcessor side effect stubbed above.
  // @ts-expect-error untyped side-effect-only module
  await import('./pcm-worklet.js')
  if (!registered) throw new Error('worklet registered no processor')
  PcmProcessor = registered
})

/** Runs `samples` through a fresh processor, returning what it emitted. */
const drive = (
  processorOptions: Record<string, number>,
  samples: Float32Array,
) => {
  const processor = new PcmProcessor({ processorOptions })
  const posted: Int16Array[] = []
  processor.port = {
    postMessage: (data: ArrayBuffer) => posted.push(new Int16Array(data)),
  }
  processor.process([[samples]])
  const postedCount = posted.reduce((n, chunk) => n + chunk.length, 0)
  return {
    posted,
    values: posted.flatMap(chunk => Array.from(chunk)),
    // Emitted = posted batches plus whatever is still buffered, so the rate
    // can be checked without choosing input sizes that land on a batch edge.
    emitted: postedCount + processor.offset,
  }
}

/** `count` samples of a constant value. */
const constant = (count: number, value: number): Float32Array =>
  new Float32Array(count).fill(value)

/** `count` samples alternating ±1 — a full-scale signal at the Nyquist limit,
 * which is exactly what naive decimation aliases and averaging suppresses. */
const alternating = (count: number): Float32Array =>
  Float32Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 1 : -1))

describe('pcm-worklet downsampling', () => {
  it('emits one sample per ratio at 48 kHz → 16 kHz', () => {
    // 6144 inputs at a 3:1 ratio is 2048 output samples: three 640-sample
    // frames posted, the remainder still buffered.
    const { posted, emitted, values } = drive(
      { inputSampleRate: 48_000, targetSampleRate: 16_000 },
      constant(6144, 0.5),
    )
    expect(emitted).toBe(2048)
    expect(posted).toHaveLength(3)
    expect(posted[0]!.length).toBe(640)
    // A constant signal survives averaging unchanged: 0.5 × 0x7fff.
    expect(values[0]).toBe(16_383)
    expect(new Set(values).size).toBe(1)
  })

  it('posts a constant 40 ms frame whatever the capture rate', () => {
    // A fixed SAMPLE count would buffer 3× longer at 16 kHz than at 48 kHz,
    // delaying every transcript and generated slide by the difference. The
    // frame is sized by duration so the pacing is rate-independent.
    const cases = [
      { inputSampleRate: 48_000, targetSampleRate: 16_000 },
      { inputSampleRate: 48_000, targetSampleRate: 48_000 },
      { inputSampleRate: 44_100, targetSampleRate: 16_000 },
      // Never upsamples, so the frame follows the 16 kHz context.
      { inputSampleRate: 16_000, targetSampleRate: 48_000 },
    ]
    for (const options of cases) {
      const { posted } = drive(options, constant(200_000, 0.5))
      const outputRate = Math.min(
        options.targetSampleRate,
        options.inputSampleRate,
      )
      expect(posted.length).toBeGreaterThan(0)
      const frameMs = (posted[0]!.length / outputRate) * 1000
      expect(frameMs).toBeCloseTo(40, 1)
    }
  })

  it('holds the output rate exact for a fractional ratio (44.1 → 16 kHz)', () => {
    // 44100/16000 = 2.75625, so the window width has to alternate between 2
    // and 3 input samples; carrying the remainder forward prevents drift.
    const inputs = 100_000
    const { emitted } = drive(
      { inputSampleRate: 44_100, targetSampleRate: 16_000 },
      constant(inputs, 0.25),
    )
    const expected = Math.floor(inputs / (44_100 / 16_000))
    expect(Math.abs(emitted - expected)).toBeLessThanOrEqual(1)
  })

  it('averages rather than dropping samples, so decimation cannot alias', () => {
    // Each output is the mean of three alternating ±1 samples = ±1/3. Picking
    // one sample instead would emit full scale (±32767) — the aliasing bug.
    const { values } = drive(
      { inputSampleRate: 48_000, targetSampleRate: 16_000 },
      alternating(6144),
    )
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) {
      expect(Math.abs(value)).toBeLessThan(0.4 * 32_767)
      expect(Math.abs(value)).toBeGreaterThan(0.25 * 32_767)
    }
  })

  it('passes audio through untouched when the rates already match', () => {
    const { emitted, values } = drive(
      { inputSampleRate: 16_000, targetSampleRate: 16_000 },
      constant(2048, 0.5),
    )
    expect(emitted).toBe(2048)
    expect(values.every(v => v === 16_383)).toBe(true)
  })

  it('never upsamples a context slower than the target', () => {
    // A 16 kHz context asked for 48 kHz must stream its own rate, not invent
    // samples — the client reports that same effective rate to the server.
    const { emitted } = drive(
      { inputSampleRate: 16_000, targetSampleRate: 48_000 },
      constant(4096, 0.5),
    )
    expect(emitted).toBe(4096)
  })

  it('treats a 0 target as native — downsampling fully off', () => {
    // STT_CAPTURE_SAMPLE_RATE=0 is the documented "no limit" setting: every
    // input sample is emitted, at the context's own rate.
    const { emitted, values } = drive(
      { inputSampleRate: 48_000, targetSampleRate: 0 },
      constant(4096, 0.5),
    )
    expect(emitted).toBe(4096)
    expect(values.every(v => v === 16_383)).toBe(true)
  })

  it('falls back to the scope sample rate when none is supplied', () => {
    // Only a target given: the 48 kHz global stands in for the context rate.
    const { emitted } = drive({ targetSampleRate: 16_000 }, constant(6144, 0.5))
    expect(emitted).toBe(2048)
  })
})
