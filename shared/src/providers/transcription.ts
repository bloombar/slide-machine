/**
 * TranscriptionProvider — audio in, phrase events out (SPEC CAP-3 / TECH-8).
 * Adapters: Google Cloud STT for the pilot; a local Whisper adapter later.
 * Interface is minimal and expected to evolve with the first adapter.
 */

/** One transcription event; `isFinal` phrases drive slide generation. */
export interface TranscriptionEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface TranscriptionStreamOptions {
  languageCode: string
  /** Preflight concept terms passed as speech-adaptation phrase hints (PREP-3). */
  phraseHints?: string[]
}

/** A live audio → text stream for one capture session. */
export interface TranscriptionStream {
  write(chunk: Uint8Array): void
  end(): void
  events: AsyncIterable<TranscriptionEvent>
}

export interface TranscriptionProvider {
  readonly name: string
  startStream(options: TranscriptionStreamOptions): TranscriptionStream
}
