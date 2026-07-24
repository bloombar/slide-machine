/**
 * TtsProvider — text in, spoken audio out (SPEC TECH-8). Keeps slide-speech
 * playback vendor-neutral: Google Cloud TTS is the first adapter, but any
 * synthesizer can be dropped in behind this interface without touching the
 * route or the client. Audio is returned as raw bytes + a MIME type so the
 * caller decides how to store/serve it, plus optional `marks` giving the real
 * audio time of positions in the spoken text (WB-2 playback sync).
 */

export interface TtsSynthesisInput {
  /** Plain text to speak (already markdown-stripped by the caller). */
  text: string
  /** BCP-47 language tag, e.g. "en-US"; the adapter maps it to a voice. */
  languageCode: string
  /** Optional explicit provider voice name; adapters may ignore it. */
  voiceName?: string
  /** Preferred voice gender — used when no explicit voiceName fits the
   * language, so the chosen persona's gender still carries across languages. */
  gender?: 'female' | 'male'
}

/**
 * The real spoken time of a character position in the synthesized text: `<mark>`
 * timepoints from the synthesizer. `charOffset` indexes the PLAIN text (not the
 * SSML), so playback can map a stroke's `charAnchor` to an audio time by
 * interpolating between bracketing marks. A pure function of (text, voice), so
 * it caches alongside the audio and is stable across whiteboard edits.
 */
export interface TtsMark {
  charOffset: number
  timeSeconds: number
}

export interface TtsSynthesisResult {
  audio: Uint8Array
  /** Sentence-boundary timepoints; empty when the voice/engine can't emit them
   * (e.g. non-SSML voices), in which case playback uses the linear fallback. */
  marks: TtsMark[]
}

export interface TtsProvider {
  readonly name: string
  /** MIME type of the audio this provider emits, e.g. 'audio/mpeg'. Declared
   * up front so callers can name/cache the file before synthesizing. */
  readonly audioMimeType: string
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult>
}
