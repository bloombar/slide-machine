/**
 * Time-join of diarized speaker intervals onto transcript segments (GEN-4
 * Phase 3). Diarization and transcription both emit timings relative to the
 * same recording session, so a segment's speaker is simply the diarized speaker
 * its words overlap most in time — no text comparison. Pure and deterministic.
 */
import type { DiarizedSpeakerSegment, WordTiming } from '@slide-machine/shared'

/** What a segment contributes to the join: its word intervals when present
 * (finer, and robust to a segment spanning a speaker change), else its own
 * [startMs, endMs] range. */
export interface JoinableSegment {
  id: string
  startMs?: number
  endMs?: number
  words?: WordTiming[]
}

/** Overlap in ms between [aStart,aEnd] and [bStart,bEnd]; 0 when disjoint. */
const overlapMs = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))

/**
 * Assigns each segment the diarized speaker it overlaps most in time. Returns
 * `segmentId → speaker`; a segment with no timing, or no overlap with any
 * interval, is omitted (left untagged). Ties resolve to the lowest speaker id.
 */
export const assignSpeakers = (
  segments: JoinableSegment[],
  diarized: DiarizedSpeakerSegment[],
): Map<string, number> => {
  const result = new Map<string, number>()
  if (!diarized.length) return result

  for (const seg of segments) {
    const intervals: ReadonlyArray<readonly [number, number]> = seg.words?.length
      ? seg.words.map(w => [w.startMs, w.endMs] as const)
      : seg.startMs != null && seg.endMs != null
        ? [[seg.startMs, seg.endMs] as const]
        : []
    if (!intervals.length) continue

    // Total overlap per speaker across the segment's intervals.
    const bySpeaker = new Map<number, number>()
    for (const [s, e] of intervals)
      for (const d of diarized) {
        const ov = overlapMs(s, e, d.startMs, d.endMs)
        if (ov > 0)
          bySpeaker.set(d.speaker, (bySpeaker.get(d.speaker) ?? 0) + ov)
      }

    // Most overlap wins; iterate speakers ascending so ties pick the lowest id.
    let best: number | undefined
    let bestOv = 0
    for (const [speaker, ov] of [...bySpeaker].sort((a, b) => a[0] - b[0]))
      if (ov > bestOv) {
        bestOv = ov
        best = speaker
      }
    if (best != null) result.set(seg.id, best)
  }
  return result
}
