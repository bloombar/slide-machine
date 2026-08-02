/**
 * One-shot transcription of a finished audio clip (GEN-4), over the very same
 * streaming TranscriptionProvider a live lecture uses — so re-transcribing a
 * recording produces text the way the room did, with no second engine to keep
 * in step. The audio is written in chunks, the write side is closed, and the
 * final phrases are joined in the order the engine emitted them.
 *
 * Keyless modes ('browser'/'none') register no server-side adapter: transcribing
 * on the server is simply unavailable then, which `serverTranscriptionAvailable`
 * reports so callers can hide the feature rather than fail at the click.
 */
import type { TranscriptionProvider } from '@slide-machine/shared'
import { registry } from '../providers/registry'
import { env } from '../config/env'
import { meterUsage } from '../billing/usage-context'
import { pcmDurationMs } from './wav'

/** How much PCM is handed to the engine per write. */
const CHUNK_BYTES = 32 * 1024

export interface TranscribeAudioInput {
  /** LINEAR16 mono PCM (no WAV header). */
  pcm: Buffer
  sampleRate: number
  /** BCP-47 or a bare locale ('en'); adapters region-qualify as needed. */
  languageCode: string
  /** Concept terms passed as speech-adaptation hints (PREP-3). */
  phraseHints?: string[]
}

/**
 * Whether this server can transcribe audio itself. The keyless engines run in
 * the browser during a live session only, so there is nothing here to hand a
 * finished recording to. Same rule the /api/config STT engine follows.
 */
export const serverTranscriptionAvailable = (): boolean =>
  env.TRANSCRIPTION_PROVIDER !== 'browser' &&
  env.TRANSCRIPTION_PROVIDER !== 'none'

/**
 * Transcribes a whole PCM buffer and returns the joined final text (empty when
 * the engine heard nothing). Throws when no server-side adapter is configured.
 */
export const transcribeAudio = async ({
  pcm,
  sampleRate,
  languageCode,
  phraseHints,
}: TranscribeAudioInput): Promise<string> => {
  const provider = registry.get<TranscriptionProvider>('transcription')
  const stream = provider.startStream({
    languageCode,
    sampleRateHertz: sampleRate,
    phraseHints,
  })

  // Drain concurrently with the writes: engines emit finals as the audio
  // arrives, and the queue must have a consumer before the stream completes.
  const phrases: string[] = []
  const drained = (async () => {
    for await (const event of stream.events) {
      if (!event.isFinal) continue
      const text = event.text.trim()
      if (text) phrases.push(text)
    }
  })()

  // Metered before the audio is sent, and in full: this path runs a finished
  // clip through the *streaming* recognizer, so it bills at the live per-minute
  // rate rather than a cheaper batch one, and the whole buffer is submitted
  // whether or not the engine returns anything (BILL-3).
  await meterUsage('sttMinutes', pcmDurationMs(pcm, sampleRate) / 60_000)

  try {
    for (let at = 0; at < pcm.length; at += CHUNK_BYTES)
      stream.write(pcm.subarray(at, at + CHUNK_BYTES))
  } finally {
    // Closes the write side; the adapter keeps the event stream open until the
    // engine has delivered the last finals for the audio already sent.
    stream.end()
  }
  await drained

  return phrases.join(' ')
}
