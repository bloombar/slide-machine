/**
 * Speaker → role mapping (GEN-4 Phase 3). Diarization emits anonymous speaker
 * tags; slide generation needs to know who is authoritative. Heuristic: within
 * one recording, the speaker with the most talk-time is the lecturer, everyone
 * else is a student (their content becomes questions/feedback). Pure.
 *
 * Scoped per recording because diarizer tags are only unique within one batch
 * job; a lecture split across sessions maps each session independently (the
 * lecturer dominates each). Cross-session speaker identity is a later refinement.
 */
import type { DiarizedSpeakerSegment, SpeakerRole } from '@slide-machine/shared'

/**
 * Returns `speaker → role` for one recording's diarized intervals: the
 * top-talking speaker is `lecturer`, the rest `student`. Ties resolve to the
 * lowest speaker id. Empty input → empty map.
 */
export const mapSpeakerRoles = (
  diarized: DiarizedSpeakerSegment[],
): Map<number, SpeakerRole> => {
  const talkMs = new Map<number, number>()
  for (const d of diarized) {
    const dur = Math.max(0, d.endMs - d.startMs)
    talkMs.set(d.speaker, (talkMs.get(d.speaker) ?? 0) + dur)
  }

  const roles = new Map<number, SpeakerRole>()
  if (!talkMs.size) return roles

  // Lecturer = most talk-time; iterate ascending so ties pick the lowest id.
  let lecturer: number | undefined
  let bestMs = -1
  for (const [speaker, ms] of [...talkMs].sort((a, b) => a[0] - b[0]))
    if (ms > bestMs) {
      bestMs = ms
      lecturer = speaker
    }

  for (const speaker of talkMs.keys())
    roles.set(speaker, speaker === lecturer ? 'lecturer' : 'student')
  return roles
}
