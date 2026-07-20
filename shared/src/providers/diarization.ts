/**
 * DiarizationProvider — retained lecture audio in, speaker-tagged time
 * intervals out (GEN-4 Phase 3). Real-time STT can't diarize, so this runs
 * post-lecture: the Google Cloud adapter submits a recording to Speech-to-Text
 * v2 BatchRecognize (Chirp 3, SpeakerDiarizationConfig), which reads the audio
 * from GCS; a mock adapter returns scripted intervals for tests. The intervals
 * are time-joined onto TranscriptSegments and mapped to lecturer/student roles.
 */

/** Whether a speaker is the lecturer (authoritative) or a student (question/
 * feedback). Resolved from talk-time, not from the diarizer directly. */
export type SpeakerRole = 'lecturer' | 'student'

/**
 * One speaker-attributed interval from diarization. `speaker` is the diarizer's
 * anonymous tag, unique only WITHIN one recording session; `startMs`/`endMs`
 * are relative to that session's start, matching TranscriptSegment word timings.
 */
export interface DiarizedSpeakerSegment {
  speaker: number
  startMs: number
  endMs: number
}

/** Locates one recording's audio for the diarizer to process. */
export interface DiarizationInput {
  /** Blob-storage key of the retained WAV. */
  audioKey: string
  sampleRate: number
  /** BCP-47 language of the audio; the adapter may need it for the model. */
  languageCode?: string
}

export interface DiarizationProvider {
  readonly name: string
  /**
   * Speaker-tagged intervals for the recording, or `[]` when diarization is
   * unavailable (no engine, missing audio) — callers leave segments untagged
   * rather than fail.
   */
  diarize(input: DiarizationInput): Promise<DiarizedSpeakerSegment[]>
}
