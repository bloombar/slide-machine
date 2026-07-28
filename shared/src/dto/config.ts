/**
 * DTO for GET /api/config — public runtime configuration the client reads at
 * boot. `sttEngine` mirrors the server's TRANSCRIPTION_PROVIDER so the live
 * speech engine is chosen by one server variable, with no client rebuild.
 */

/** The live-session speech engine the client should use. */
export type SttEngine = 'browser' | 'google-cloud' | 'none'

export interface RuntimeConfig {
  sttEngine: SttEngine
  /** Whether slide/deck text-to-speech playback is available (TTS provider
   * configured with a usable key). When false the client hides the play
   * button and the per-slide "Speak this slide" option. */
  ttsEnabled: boolean
  /** Default strength (1–5) the "Refine all slides" slider starts at (GEN-4). */
  refineSlidesDefaultLevel: number
  /** Default strength (1–5) the "Refine the spoken transcript" slider starts at. */
  refineTranscriptDefaultLevel: number
  /** Debug aid: whether the live session shows the "simulated speech" text box
   * that feeds typed phrases through the spoken-phrase pipeline. Off unless a
   * server sets SIMULATED_SPEECH_ENABLED. */
  simulatedSpeechEnabled: boolean
  /** How long (ms) after the last drawing/erasing gesture the client keeps
   * suppressing auto-slide-creation while recording (WB-3), so a pause to
   * switch tools or reposition the cursor still counts as active use. */
  whiteboardSuppressDebounceMs: number
}
