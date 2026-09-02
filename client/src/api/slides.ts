/**
 * Background image pickup (IMG-1/GEN-5): enrichment runs server-side off
 * the critical path, so the client re-reads the slide a few times until
 * the image lands or the attempts run out. Failures are silent — the
 * slide simply resolves to its no-image fallback.
 */
import type {
  DeckRefineSlideTranscriptResult,
  ImageAttribution,
  ImageSearchCandidate,
  Locale,
  Slide,
  SlideRegenerateTranscriptResult,
  Stroke,
  TtsMark,
} from '@slide-machine/shared'
import { apiFetch, ApiError } from './http'
import { dispatchAction } from './actions'
import { config } from '../config'
import { getAccessToken, refreshSession } from '../auth/token'

/**
 * Replaces (or sets) a slide's image from an uploaded file (EDIT-1). `slot`
 * names which image box it belongs to — a template author's layout may have
 * several (TMPL-4); omitted means the conventional one.
 */
export const uploadSlideImage = (
  slideId: string,
  file: File,
  slot?: string,
): Promise<Slide> => {
  const form = new FormData()
  form.append('file', file)
  if (slot) form.append('slot', slot)
  return apiFetch<Slide>(`/api/slides/${slideId}/image`, {
    method: 'POST',
    body: form,
  })
}

/**
 * Searches permitted web sources for images to replace a slide's picture
 * (EDIT-1). An empty query lets the server fall back to the slide's own
 * keywords, so results relate to what the slide is about.
 */
export const searchSlideImages = (
  slideId: string,
  query = '',
): Promise<ImageSearchCandidate[]> =>
  apiFetch<ImageSearchCandidate[]>(`/api/slides/${slideId}/image-candidates`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

/** Sets a slide's image to a chosen web search result (EDIT-1). */
export const applySlideImageFromSource = (
  slideId: string,
  url: string,
  attribution?: ImageAttribution,
  slot?: string,
): Promise<Slide> =>
  apiFetch<Slide>(`/api/slides/${slideId}/image-from-source`, {
    method: 'POST',
    body: JSON.stringify({ url, attribution, slot }),
  })

/**
 * Persists a slide's whiteboard drawings wholesale (WB-1). Called after each
 * draw or (timestamped) erase; erased strokes are kept so playback can replay
 * the erasure. Returns the refreshed slide so the viewer can patch it in place.
 */
export const editSlideDrawings = (
  slideId: string,
  drawings: Stroke[],
): Promise<Slide> =>
  dispatchAction<Slide>('slide.editDrawings', { slideId, drawings })

/**
 * Saves a hand-edited spoken transcript for a slide (EDIT-6). The server
 * re-anchors the slide's whiteboard marks onto the new text, so the refreshed
 * slide it returns carries the updated `drawings` and must replace the local
 * copy wholesale.
 */
export const editSlideTranscript = (
  slideId: string,
  transcript: string,
): Promise<Slide> =>
  dispatchAction<Slide>('slide.editTranscript', { slideId, transcript })

/**
 * Reconciles a slide's stored transcript with the finalized wording of a
 * phrase flushed mid-utterance (GEN-12): the interim-flush hypothesis
 * (`find`) that was submitted mid-speech is swapped for what the recognizer
 * settled on (`replace`) once the utterance finalized. A no-op — the returned
 * slide is unchanged — when `find` is no longer present, or the user has
 * since hand-edited this slide's transcript themselves (that edit always
 * wins). Re-anchors whiteboard marks the same way `editSlideTranscript` does.
 */
export const reconcileSlideTranscript = (
  slideId: string,
  find: string,
  replace: string,
): Promise<Slide> =>
  dispatchAction<Slide>('slide.editTranscript', {
    slideId,
    correction: { find, replace },
  })

/**
 * Re-transcribes a slide from its retained lecture audio (GEN-4) and returns
 * what the speech engine heard. By default nothing is written — the transcript
 * editor shows the text for the user to accept or discard. Pass `save` to write
 * it straight to the slide (with its whiteboard marks re-anchored), which is how
 * a regenerate-every-slide pass would call this, one slide at a time.
 */
export const regenerateSlideTranscript = (
  slideId: string,
  save = false,
): Promise<SlideRegenerateTranscriptResult> =>
  dispatchAction<SlideRegenerateTranscriptResult>(
    'slide.regenerateTranscript',
    { slideId, save },
  )

/**
 * Refines one slide's spoken narration (EDIT-6) and returns the rewritten text.
 * This is the same narration pass, at the same strength, that "Refine this
 * slide" and the lecture-wide Refine run. By default nothing is written — the
 * transcript editor shows the result for review; pass `save` to apply it.
 */
export const refineSlideTranscript = (
  deckId: string,
  slideId: string,
  save = false,
): Promise<DeckRefineSlideTranscriptResult> =>
  dispatchAction<DeckRefineSlideTranscriptResult>(
    'deck.refineSlideTranscript',
    {
      deckId,
      slideId,
      save,
    },
  )

/**
 * Synthesizes speech for a slide and returns a playable audio URL (or null
 * when there's nothing to say). `content` speaks the rendered slide;
 * `transcript` speaks the stored lecture transcript (narrated from content by
 * the server when the slide has none).
 *
 * `text` speaks exactly those words instead — how the transcript editor
 * previews a narration before it is saved (EDIT-6); it needs edit rights and
 * shares the audio cache with playing the same words back once saved.
 *
 * `locale` is the language the slides are being read in (PLAY-3): narration
 * follows the screen, so the server translates the narration and speaks it in
 * that language. Omitted when the deck is being read as it was written, which
 * keeps the request identical to what it has always been.
 */
export const synthesizeSlideTts = (
  slideId: string,
  mode: 'content' | 'transcript',
  options: { text?: string; locale?: Locale | null } = {},
): Promise<{ url: string | null; marks: TtsMark[] }> =>
  apiFetch<{ url: string | null; marks: TtsMark[] }>(
    `/api/slides/${slideId}/tts`,
    {
      method: 'POST',
      body: JSON.stringify({
        mode,
        ...(options.text === undefined ? {} : { text: options.text }),
        ...(options.locale ? { locale: options.locale } : {}),
      }),
    },
  )

/**
 * Fetches a slide's original lecture audio (GEN-4) as an object URL for an
 * <audio> element. The clip is access-gated (it holds student voices), so it
 * can't be a plain <audio src>: we fetch the bytes with the Bearer token and
 * wrap them in a blob URL the caller must revoke. Throws on 403/404 (no
 * retained audio for the slide, e.g. the recording aged out).
 */
export const fetchSlideOriginalAudioUrl = async (
  slideId: string,
): Promise<string> => {
  const request = async (retry: boolean): Promise<Response> => {
    const token = getAccessToken()
    const res = await fetch(
      `${config.apiBaseUrl}/api/slides/${slideId}/audio`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    )
    if (res.status === 401 && retry && (await refreshSession()))
      return request(false)
    return res
  }
  const res = await request(true)
  if (!res.ok) throw new ApiError(res.status, 'audio_error', res.statusText)
  return URL.createObjectURL(await res.blob())
}

interface PollOptions {
  attempts?: number
  /**
   * Flattens every attempt's delay to this one value instead of the ramp
   * schedule below (used by tests to run the whole poll on a fast, even
   * grid). Note that `attempts` no longer scales against a fixed 1500ms
   * step on its own — pair it with `fixedDelayMs` if you want the old
   * `attempts * intervalMs` window back; against the default ramp,
   * `attempts` alone re-scales the *ramp's* window, not 1500ms per step.
   */
  fixedDelayMs?: number
}

// IMG-1: the delay before each attempt, keyed by attempt index. Starts at
// 250ms so the common case — the image already landed by the time the
// slide finished rendering — shows up almost immediately instead of behind
// a fixed 1.5s wait, then ramps up to a 1500ms ceiling: enrichment includes
// an AI re-rank (and, when enabled, a vision pass), so a slow image can
// genuinely take that long, and it still needs the same long window to
// land as before. Indices past the array reuse the ceiling. `fixedDelayMs`
// (below, on PollOptions) still lets a caller pin every attempt to one flat
// delay — tests use it to run the whole poll on a 1ms grid — in which case
// this ramp is bypassed entirely.
const DELAY_SCHEDULE_MS = [250, 500, 1000]
const CEILING_MS = 1500

/**
 * Polls slide.get until an image appears or attempts are exhausted, then
 * calls onResolved with the enriched slide (or null). Returns a cancel
 * function for unmount cleanup.
 */
export const pollSlideImage = (
  slideId: string,
  onResolved: (slide: Slide | null) => void,
  options: PollOptions = {},
): (() => void) => {
  // ~18s window at the default schedule (250+500+1000 ramp, then eleven
  // more attempts at the 1500ms ceiling = 18.25s total): enrichment now
  // includes an AI re-rank (and, when enabled, a vision pass), so the
  // image + matched caption can take longer to land than a bare source
  // search. `attempts` is 14 rather than the old flat schedule's 12
  // because the faster ramp-up attempts cost less wall-clock time than
  // the 1500ms they replace, and the window must not shrink.
  const attempts = options.attempts ?? 14
  const fixedDelayMs = options.fixedDelayMs
  let cancelled = false

  const run = async () => {
    for (let i = 0; i < attempts && !cancelled; i++) {
      const delay = fixedDelayMs ?? DELAY_SCHEDULE_MS[i] ?? CEILING_MS
      await new Promise(resolve => setTimeout(resolve, delay))
      if (cancelled) return
      try {
        const slide = await dispatchAction<Slide>('slide.get', { slideId })
        if (cancelled) return
        if (slide.imageRef) {
          onResolved(slide)
          return
        }
      } catch {
        // Silent: enrichment must never interrupt the session (IMG-2)
      }
    }
    if (!cancelled) onResolved(null)
  }

  void run()
  return () => {
    cancelled = true
  }
}
