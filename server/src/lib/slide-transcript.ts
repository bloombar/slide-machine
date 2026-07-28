/**
 * A slide's spoken transcript — the text TTS reads during playback (PLAY-2) —
 * written and regenerated in one place.
 *
 * `applySlideTranscript` is the single writer: whiteboard marks are timed by
 * character offsets into this very text (WB-2), so every rewrite re-anchors them
 * onto the new wording instead of stranding them.
 *
 * `regenerateSlideTranscript` re-transcribes ONE slide from its retained lecture
 * audio (GEN-4). It is deliberately per-slide and complete on its own — audio
 * lookup, transcription, optional save — so regenerating a whole deck is a plain
 * loop over its slides with no logic of its own.
 */
import type { HydratedDocument } from 'mongoose'
import type { GenerationProvider, Stroke } from '@slide-machine/shared'
import { remapDrawingAnchors } from '../actions/remap-drawings'
import { registry } from '../providers/registry'
import { touchDeck, type DeckDb } from '../models/deck'
import type { SlideDb } from '../models/slide'
import { HttpError } from '../middleware/error'
import { buildSlideAudio } from './slide-audio'
import {
  serverTranscriptionAvailable,
  transcribeAudio,
} from './transcribe-audio'

/**
 * Replaces a slide's spoken transcript and saves it, re-anchoring its
 * whiteboard marks onto the new text: each mark's stored phrase fingerprint is
 * semantically re-matched to the closest phrase of the new transcript
 * (proportional fallback when there is no fingerprint or embeddings are
 * unavailable). Returns false when the text is unchanged (nothing written).
 *
 * `narrateInputHash` is deliberately left alone: on a diarized slide it makes
 * the next refine skip re-narration, so a deliberately-set transcript is
 * protected the way `manuallyEdited` protects hand-edited content (GEN-4).
 */
export const applySlideTranscript = async (
  slide: HydratedDocument<SlideDb>,
  transcript: string,
): Promise<boolean> => {
  const oldTranscript = slide.sourceTranscript ?? ''
  if (oldTranscript === transcript) return false
  slide.sourceTranscript = transcript

  if (slide.drawings?.length) {
    // toObject() yields plain strokes (safe to spread) rather than subdocuments.
    const plain = (slide.toObject().drawings ?? []) as Stroke[]
    const gen = registry.get<GenerationProvider>('generation')
    slide.set(
      'drawings',
      await remapDrawingAnchors(plain, oldTranscript, transcript, texts =>
        gen.embedTexts(texts),
      ),
    )
  }

  await slide.save()
  await touchDeck(slide.deckId)
  return true
}

export interface RegenerateTranscriptOptions {
  /** Write the result to the slide (re-anchoring marks); false only returns it,
   * which is what the transcript editor wants — the user still decides. */
  save?: boolean
}

export interface RegeneratedTranscript {
  /** What the speech engine heard in the slide's recorded audio. */
  transcript: string
  /** Whether it was written to the slide. */
  saved: boolean
}

/**
 * Re-transcribes one slide from its retained lecture audio. Throws a 404 when
 * no audio remains for the slide (it was never recorded, or aged out) and a 503
 * when the server has no speech engine configured — both are states the caller
 * should have hidden the option for, so they read as errors rather than an
 * empty result.
 */
export const regenerateSlideTranscript = async (
  deck: HydratedDocument<DeckDb>,
  slide: HydratedDocument<SlideDb>,
  options: RegenerateTranscriptOptions = {},
): Promise<RegeneratedTranscript> => {
  if (!serverTranscriptionAvailable()) {
    throw new HttpError(
      503,
      'transcription_unavailable',
      'This server has no speech engine to transcribe with',
    )
  }
  const audio = await buildSlideAudio(deck, slide)
  if (!audio) {
    throw new HttpError(
      404,
      'no_audio',
      'No recorded audio remains for this slide',
    )
  }

  const transcript = await transcribeAudio({
    pcm: audio.pcm,
    sampleRate: audio.sampleRate,
    // The lecture's language when set; adapters region-qualify a bare locale.
    languageCode: deck.language ?? 'en',
  })

  const saved = options.save
    ? await applySlideTranscript(slide, transcript)
    : false
  return { transcript, saved }
}
