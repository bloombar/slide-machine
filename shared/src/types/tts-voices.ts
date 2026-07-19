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
  /** Stable id stored on the project/lecture. */
  id: string
  /** Everyday label shown in the picker. */
  label: string
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
    label: 'Emma — warm female',
    voiceName: 'en-US-Neural2-F',
    gender: 'female',
    tier: 'standard',
  },
  {
    id: 'sophie',
    label: 'Sophie — bright female',
    voiceName: 'en-US-Neural2-C',
    gender: 'female',
    tier: 'standard',
  },
  {
    id: 'james',
    label: 'James — deep male',
    voiceName: 'en-US-Neural2-D',
    gender: 'male',
    tier: 'standard',
  },
  {
    id: 'daniel',
    label: 'Daniel — clear male',
    voiceName: 'en-US-Neural2-J',
    gender: 'male',
    tier: 'standard',
  },
  // Premium tier — Google Chirp3-HD (most natural).
  {
    id: 'aria',
    label: 'Aria — natural female (premium)',
    voiceName: 'en-US-Chirp3-HD-Aoede',
    gender: 'female',
    tier: 'premium',
  },
  {
    id: 'nova',
    label: 'Nova — natural female (premium)',
    voiceName: 'en-US-Chirp3-HD-Leda',
    gender: 'female',
    tier: 'premium',
  },
  {
    id: 'leo',
    label: 'Leo — natural male (premium)',
    voiceName: 'en-US-Chirp3-HD-Charon',
    gender: 'male',
    tier: 'premium',
  },
  {
    id: 'owen',
    label: 'Owen — natural male (premium)',
    voiceName: 'en-US-Chirp3-HD-Orus',
    gender: 'male',
    tier: 'premium',
  },
]

/** Looks up a catalog voice by id. */
export const findTtsVoice = (id?: string): TtsVoiceOption | undefined =>
  id ? TTS_VOICES.find(v => v.id === id) : undefined
