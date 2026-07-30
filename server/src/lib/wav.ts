/**
 * Minimal WAV container for retained lecture audio (GEN-4 Phase 2). The STT
 * transport streams raw LINEAR16 (16-bit little-endian) mono PCM; wrapping it
 * in a 44-byte canonical WAV header makes the retained blob a standalone,
 * playable file that the later batch-diarization pass can submit as-is.
 */

/** Bytes per sample for LINEAR16 (16-bit) mono. */
const BYTES_PER_SAMPLE = 2

/**
 * Wraps raw LINEAR16 mono PCM in a WAV header. `sampleRate` is the capture
 * rate the client reported (its AudioContext rate). Returns the complete WAV.
 */
export const pcmToWav = (pcm: Buffer, sampleRate: number): Buffer => {
  const dataLen = pcm.length
  const byteRate = sampleRate * BYTES_PER_SAMPLE
  const header = Buffer.alloc(44)

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataLen, 4) // RIFF chunk size = 36 + data
  header.write('WAVE', 8, 'ascii')

  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20) // audio format = 1 (PCM)
  header.writeUInt16LE(1, 22) // channels = 1 (mono)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32) // block align (mono, 16-bit)
  header.writeUInt16LE(16, 34) // bits per sample

  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataLen, 40)

  return Buffer.concat([header, pcm])
}

/** Duration in ms of `byteLength` bytes of LINEAR16 mono PCM at `sampleRate`.
 * Byte-based so a streamed recording — which is never held as one buffer — can
 * report its length from the running total. */
export const pcmBytesDurationMs = (
  byteLength: number,
  sampleRate: number,
): number =>
  sampleRate > 0 ? (byteLength / (sampleRate * BYTES_PER_SAMPLE)) * 1000 : 0

/** Duration in ms of a LINEAR16 mono PCM buffer at `sampleRate`. */
export const pcmDurationMs = (pcm: Buffer, sampleRate: number): number =>
  pcmBytesDurationMs(pcm.length, sampleRate)
