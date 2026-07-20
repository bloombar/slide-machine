/**
 * TranscriptionProvider — audio in, phrase events out (SPEC CAP-3 / TECH-8).
 * Adapters: Google Cloud STT for the pilot; a local Whisper adapter later.
 * Interface is minimal and expected to evolve with the first adapter.
 */

/**
 * One word with its timing, relative to the start of its recording session
 * (see WordTiming below). Emitted only on final events by engines that
 * support word offsets; carries the per-word confidence when available.
 */
export interface WordTiming {
  word: string
  /** Milliseconds from the recording session's start. */
  startMs: number
  /** Milliseconds from the recording session's start. */
  endMs: number
  confidence?: number
}

/** One transcription event; `isFinal` phrases drive slide generation. */
export interface TranscriptionEvent {
  text: string
  isFinal: boolean
  confidence: number
  /**
   * Per-word timings for a final phrase, session-absolute (GEN-4 diarization
   * groundwork). Present only from engines with word-offset support (Google
   * Cloud); absent for the keyless browser engine. */
  words?: WordTiming[]
}

export interface TranscriptionStreamOptions {
  languageCode: string
  /** Preflight concept terms passed as speech-adaptation phrase hints (PREP-3). */
  phraseHints?: string[]
  /** Sample rate of the incoming PCM audio; the client reports its actual
   * AudioContext rate so no resampling is needed. Defaults to 16 kHz. */
  sampleRateHertz?: number
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
