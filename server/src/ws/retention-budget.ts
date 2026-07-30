/**
 * Process-wide ceiling on the memory live audio retention may hold (GEN-4).
 *
 * Audio now streams to storage as it arrives, so a session's cost no longer
 * grows with its length — it is a fixed in-flight window (the upload's own
 * buffer plus its parts in flight, `UPLOAD_MEMORY_WINDOW_BYTES`). What still
 * needs bounding is CONCURRENCY: every simultaneous recording claims another
 * window, and audio Buffers live outside the V8 heap, so an overrun surfaces as
 * RSS growth and an OOM kill rather than a catchable heap error.
 *
 * So each retaining session reserves one window when it starts and releases it
 * once the upload has finished or been abandoned. The budget therefore answers
 * "how many lectures may record at once", and the ceiling can be far smaller
 * than when whole sessions were buffered.
 *
 * Declining only ever costs the retained audio copy — transcription, slide
 * generation, and the transcript are untouched.
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
