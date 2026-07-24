/**
 * Deterministic mock TtsProvider (TTS_PROVIDER=mock) — returns a tiny, valid
 * silent WAV so tests and e2e exercise the full synthesize → store → play path
 * without calling a paid API. The audio is real (browsers can load and 'end'
 * it); only its content is silence.
 */
import type {
  TtsMark,
  TtsProvider,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from '@slide-machine/shared'
import { segmentPhrases } from '@slide-machine/shared'
import { registry } from './registry'

/** Estimated clip seconds the mock "spans" — evenly spread marks across it so
 * the resolver has a monotonic timeline to interpolate over in tests. */
const MOCK_DURATION_SECONDS = 5

/** Builds a ~50ms silent 8 kHz 8-bit mono PCM WAV. */
const buildSilentWav = (): Buffer => {
  const sampleRate = 8000
  const dataSize = 400 // ~50ms of samples
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM fmt chunk size
  buf.writeUInt16LE(1, 20) // audio format: PCM
  buf.writeUInt16LE(1, 22) // channels: mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate, 28) // byte rate (mono, 8-bit)
  buf.writeUInt16LE(1, 32) // block align
  buf.writeUInt16LE(8, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  buf.fill(128, 44) // 8-bit unsigned silence = 128
  return buf
}

export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock'
  readonly audioMimeType = 'audio/wav'

  async synthesize({ text }: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    // Evenly-spaced synthetic timepoints at each phrase boundary, so tests
    // exercise the mark-driven resolve path deterministically.
    const phrases = segmentPhrases(text ?? '')
    const marks: TtsMark[] = phrases.map((p, i) => ({
      charOffset: p.start,
      timeSeconds: (i / Math.max(1, phrases.length)) * MOCK_DURATION_SECONDS,
    }))
    return { audio: buildSilentWav(), marks }
  }
}

registry.register('tts', 'mock', () => new MockTtsProvider())
