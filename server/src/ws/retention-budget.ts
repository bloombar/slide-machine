/**
 * Process-wide ceiling on live audio-retention buffers (GEN-4 Phase 2).
 *
 * The per-session cap in audio-socket.ts bounds ONE recording; it does not
 * bound the process. Every concurrent session claims its own buffer, and audio
 * Buffers live outside the V8 heap, so an overrun surfaces as RSS growth and an
 * OOM kill rather than a catchable heap error. This tracks the bytes currently
 * held across all sessions so retention can be declined before that happens.
 *
 * Declining only ever costs the retained audio copy — transcription, slide
 * generation, and the transcript are untouched, exactly like the per-session
 * cap. Accounting is deliberately conservative: bytes stay reserved until the
 * flush finishes, because the flush is the peak (it concatenates the buffered
 * chunks into one WAV before handing it to storage).
 */
import { env } from '../config/env'

const BYTES_PER_MB = 1024 * 1024

/** Bytes currently held by in-flight retention buffers, process-wide. */
let heldBytes = 0

/** The configured ceiling in bytes; 0 disables the global limit. */
const budgetBytes = (): number =>
  env.AUDIO_RETENTION_MAX_TOTAL_MB * BYTES_PER_MB

/** Bytes currently reserved across all sessions (for tests and diagnostics). */
export const retainedBytesHeld = (): number => heldBytes

/**
 * True when a NEW session may start retaining. A session already under way
 * keeps its reservation; only fresh ones are turned away, so a long lecture is
 * never truncated by someone else starting one.
 */
export const canStartRetention = (): boolean => {
  const budget = budgetBytes()
  return budget === 0 || heldBytes < budget
}

/**
 * Reserves `bytes` if the global budget allows, returning whether it did. A
 * refusal means the caller must not buffer that audio.
 */
export const reserveRetentionBytes = (bytes: number): boolean => {
  const budget = budgetBytes()
  if (budget !== 0 && heldBytes + bytes > budget) return false
  heldBytes += bytes
  return true
}

/** Releases a session's reservation once its buffers are gone. */
export const releaseRetentionBytes = (bytes: number): void => {
  heldBytes = Math.max(0, heldBytes - bytes)
}

/** Test hook: clears all reservations between cases. */
export const resetRetentionBudget = (): void => {
  heldBytes = 0
}
