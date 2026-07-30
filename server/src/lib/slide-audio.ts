/**
 * A slide's original lecture audio (GEN-4): the retained session recordings,
 * sliced to the slide's own timed transcript segments and stitched, in speech
 * order, into one clip. Shared by playback (GET /api/slides/:slideId/audio) and
 * re-transcription (slide.regenerateTranscript), so both work from exactly the
 * same audio. Segments whose recording has aged out are skipped; a slide with
 * nothing left resolves to null.
 *
 * Each segment is fetched as a byte RANGE rather than by downloading the whole
 * recording: a slide's audio is seconds long, the recording behind it can be
 * hours, and this path is reachable by any viewer with playback access — so
 * reading whole objects made memory a function of lecture length.
 */
import type { HydratedDocument } from 'mongoose'
import type { DeckDb } from '../models/deck'
import type { SlideDb } from '../models/slide'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { getStorage } from '../storage'
import { pcmToWav } from './wav'

// Recordings are stored as raw LINEAR16 mono PCM (`.pcm`) — a WAV header must
// state a total length that is unknown until the lecture ends, which streaming
// cannot provide. Recordings retained BEFORE that change are `.wav`: a
// canonical 44-byte header then the same PCM. Both are read here until the last
// legacy recording ages out (AUDIO_RETENTION_DAYS), after which the offset and
// this comment can go.
const WAV_HEADER_BYTES = 44
const bodyOffset = (audioKey: string): number =>
  audioKey.endsWith('.wav') ? WAV_HEADER_BYTES : 0
const BYTES_PER_SAMPLE = 2
// Word-end timestamps tend to land slightly before the sound actually stops, so
// each segment's tail is extended by this much (clamped to the recording) to
// avoid clipping the last word.
const TAIL_PAD_MS = 400

/** One slide's stitched original audio. */
export interface SlideAudio {
  /** LINEAR16 mono PCM: the slide's segments, back to back in speech order. */
  pcm: Buffer
  /** Capture rate of the recording the slices came from. */
  sampleRate: number
}

/**
 * Stitches the retained audio of `slide` out of its deck's recordings, or
 * returns null when none of its segments has audio left.
 */
export const buildSlideAudio = async (
  deck: HydratedDocument<DeckDb>,
  slide: HydratedDocument<SlideDb>,
): Promise<SlideAudio | null> => {
  // The recording (audio blob) still retained for each session, by sessionId.
  const recBySession = new Map(
    (deck.recordings ?? []).map(r => [r.sessionId, r]),
  )
  if (!recBySession.size) return null

  const segments = await TranscriptSegmentModel.find({
    deckId: deck._id,
    slideId: slide._id,
    startMs: { $ne: null },
  }).sort({ createdAt: 1 })

  const storage = getStorage()
  const slices: Buffer[] = []
  let sampleRate = 0
  for (const seg of segments) {
    const rec = seg.sessionId ? recBySession.get(seg.sessionId) : undefined
    if (!rec) continue

    // Length of the recording's PCM body, derived from what the deck already
    // stores — no HEAD request, no schema change. Rounding `durationMs` to the
    // millisecond can be a few bytes off; harmless, since reads past the end
    // return only what exists and every offset is clamped to this anyway.
    const pcmBytes = Math.max(
      0,
      Math.floor((rec.durationMs / 1000) * rec.sampleRate) * BYTES_PER_SAMPLE,
    )
    // Segment times are session-absolute ms into this recording's PCM body.
    const toByte = (ms: number): number =>
      Math.max(
        0,
        Math.min(
          Math.floor((ms / 1000) * rec.sampleRate) * BYTES_PER_SAMPLE,
          pcmBytes,
        ),
      )
    const start = toByte(seg.startMs as number)
    // Pad the tail so the last word is never cut off (clamped in toByte).
    const end = seg.endMs != null ? toByte(seg.endMs + TAIL_PAD_MS) : pcmBytes
    if (end <= start) continue

    // Read ONLY this segment's bytes. Pulling the whole object here would load
    // an entire lecture recording to play back a few seconds of it, on a path
    // any viewer can trigger.
    const offset = bodyOffset(rec.audioKey)
    const slice = await storage.getRange(
      rec.audioKey,
      offset + start,
      offset + end,
    )
    if (!slice?.length) continue
    slices.push(slice)
    if (!sampleRate) sampleRate = rec.sampleRate
  }

  if (!slices.length) return null
  return { pcm: Buffer.concat(slices), sampleRate }
}

/** The stitched audio as a standalone, playable WAV. */
export const slideAudioWav = (audio: SlideAudio): Buffer =>
  pcmToWav(audio.pcm, audio.sampleRate)
