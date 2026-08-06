/**
 * DTO for GET /api/config — public runtime configuration the client reads at
 * boot. `sttEngine` mirrors the server's TRANSCRIPTION_PROVIDER so the live
 * speech engine is chosen by one server variable, with no client rebuild.
 */

/** The live-session speech engine the client should use. */
export type SttEngine = 'browser' | 'google-cloud' | 'none'

/**
 * Who runs this deployment, for the privacy policy and the terms to name
 * (`OPERATOR_*` in the server environment). Configuration rather than source,
 * so a change of address is a restart and not a release.
 *
 * Every field is a string, empty where the server was given nothing: the
 * client substitutes its own placeholder per field, and an absent value is
 * the deployment declining to say rather than an error. Nothing here is a
 * secret — these appear verbatim on two public pages.
 */
export interface OperatorDetails {
  /** The legal entity behind the service. */
  name: string
  /** Whose law governs the terms, and where disputes are heard. */
  jurisdiction: string
  /** Where privacy and legal correspondence should go — not the feedback
   * address, which stays server-side. */
  contactEmail: string
  /** Postal address, where a policy is expected to give one. */
  postalAddress: string
}

export interface RuntimeConfig {
  sttEngine: SttEngine
  /** Whether slide/deck text-to-speech playback is available (TTS provider
   * configured with a usable key). When false the client hides the play
   * button and the per-slide "Speak this slide" option. */
  ttsEnabled: boolean
  /** Whether post-lecture translated viewing is available (translation
   * provider configured with a usable key — SHARE-2). When false the client
   * hides the deck viewer's slide-language switcher. */
  translationEnabled: boolean
  /** Whether the "Send feedback" form can deliver: the server has a working
   * mail transport and an address to send to. When false the client leaves
   * the entry point out of the menu rather than offering a form that would
   * refuse the message. */
  feedbackEnabled: boolean
  /** Whether the server can send mail at all. The account pages phrase
   * verification and password recovery around this rather than promising a
   * link a deployment with no relay could never deliver (AUTH-3/AUTH-4). */
  mailEnabled: boolean
  /** Who runs this deployment, named by the privacy policy and the terms.
   * Blank fields fall back to the client's placeholders, which read as the
   * draft they are. */
  operator: OperatorDetails
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
  /** Rate (Hz) the mic capture downsamples to before streaming to the server
   * (CAP-3). 24 kHz by default — above the 16 kHz the speech models want, to
   * keep the recording pleasant for per-slide playback; the browser's native
   * 48 kHz would triple the bytes for no transcription gain. A client whose
   * AudioContext already runs at or below this streams its native rate. */
  sttCaptureSampleRate: number
}
