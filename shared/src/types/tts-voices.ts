/**
 * The curated set of narration voices the user can pick from, with everyday
 * names instead of provider voice codes. Each option carries its gender, so
 * selecting a voice sets the gender automatically — and when a lecture's
 * language differs from a voice's base language, the server falls back to a
 * same-gender voice in that language (see the TTS route). The `voiceName`s are
 * Google Cloud voices for the base language (en-US); other languages resolve
 * by gender.
 *
 * `tier` marks provider cost/quality: 'standard' voices (Neural2) are the
 * everyday default; 'premium' voices (Chirp3-HD) are the most natural. All are
 * available to everyone for now; premium will later be gated to paid plans —
 * hence the field, so that gate has something to key on.
 */

export type TtsVoiceGender = 'female' | 'male'
export type TtsVoiceTier = 'standard' | 'premium'

export interface TtsVoiceOption {
  /** Stable id stored on the project/lecture. It also keys the voice's
   * one-line description in the client's locale bundles
   * (`voice.descriptions.<id>`) — a proper name reads the same in every
   * language, but "warm female" does not, so only the description is
   * translated (docs/I18N.md). */
  id: string
  /** The voice's given name, shown as-is in every language. */
  name: string
  /** Provider voice for the base language (en-US). */
  voiceName: string
  /** Set automatically when a voice is chosen; the cross-language fallback. */
  gender: TtsVoiceGender
  tier: TtsVoiceTier
}

/** Base language the catalog's `voiceName`s belong to. */
export const TTS_VOICE_BASE_LANGUAGE = 'en-US'

export const TTS_VOICES: readonly TtsVoiceOption[] = [
  // Standard tier — Google Neural2 (natural, everyday cost).
  {
    id: 'emma',
    name: 'Emma',
    voiceName: 'en-US-Neural2-F',
    gender: 'female',
    tier: 'standard',
  },
  {
    id: 'sophie',
    name: 'Sophie',
    voiceName: 'en-US-Neural2-C',
    gender: 'female',
    tier: 'standard',
  },
  {
    id: 'james',
    name: 'James',
    voiceName: 'en-US-Neural2-D',
    gender: 'male',
    tier: 'standard',
  },
  {
    id: 'daniel',
    name: 'Daniel',
    voiceName: 'en-US-Neural2-J',
    gender: 'male',
    tier: 'standard',
  },
  // Premium tier — Google Chirp3-HD (most natural).
  {
    id: 'aria',
    name: 'Aria',
    voiceName: 'en-US-Chirp3-HD-Aoede',
    gender: 'female',
    tier: 'premium',
  },
  {
    id: 'nova',
    name: 'Nova',
    voiceName: 'en-US-Chirp3-HD-Leda',
    gender: 'female',
    tier: 'premium',
  },
  {
    id: 'leo',
    name: 'Leo',
    voiceName: 'en-US-Chirp3-HD-Charon',
    gender: 'male',
    tier: 'premium',
  },
  {
    id: 'owen',
    name: 'Owen',
    voiceName: 'en-US-Chirp3-HD-Orus',
    gender: 'male',
    tier: 'premium',
  },
]

/** Looks up a catalog voice by id. */
export const findTtsVoice = (id?: string): TtsVoiceOption | undefined =>
  id ? TTS_VOICES.find(v => v.id === id) : undefined
