/**
 * Deterministic mock TtsProvider (TTS_PROVIDER=mock) — returns a tiny, valid
 * silent WAV so tests and e2e exercise the full synthesize → store → play path
 * without calling a paid API. The audio is real (browsers can load and 'end'
 * it); only its content is silence.
 */
import type { TtsProvider } from '@slide-machine/shared'
import { registry } from './registry'

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

  async synthesize(): Promise<Uint8Array> {
    return buildSilentWav()
  }
}

registry.register('tts', 'mock', () => new MockTtsProvider())
