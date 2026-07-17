/**
 * DTO for GET /api/config — public runtime configuration the client reads at
 * boot. `sttEngine` mirrors the server's TRANSCRIPTION_PROVIDER so the live
 * speech engine is chosen by one server variable, with no client rebuild.
 */

/** The live-session speech engine the client should use. */
export type SttEngine = 'browser' | 'google-cloud' | 'none'

export interface RuntimeConfig {
  sttEngine: SttEngine
}
