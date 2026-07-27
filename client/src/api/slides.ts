/**
 * Background image pickup (IMG-1/GEN-5): enrichment runs server-side off
 * the critical path, so the client re-reads the slide a few times until
 * the image lands or the attempts run out. Failures are silent — the
 * slide simply resolves to its no-image fallback.
 */
import type {
  ImageAttribution,
  ImageSearchCandidate,
  Slide,
  Stroke,
  TtsMark,
} from '@slide-machine/shared'
import { apiFetch, ApiError } from './http'
import { dispatchAction } from './actions'
import { config } from '../config'
import { getAccessToken, refreshSession } from '../auth/token'

/** Replaces (or sets) a slide's image from an uploaded file (EDIT-1). */
export const uploadSlideImage = (
  slideId: string,
  file: File,
): Promise<Slide> => {
  const form = new FormData()
  form.append('file', file)
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
): Promise<Slide> =>
  apiFetch<Slide>(`/api/slides/${slideId}/image-from-source`, {
    method: 'POST',
    body: JSON.stringify({ url, attribution }),
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
 * Synthesizes speech for a slide and returns a playable audio URL (or null
 * when there's nothing to say). `content` speaks the rendered slide;
 * `transcript` speaks the stored lecture transcript (narrated from content by
 * the server when the slide has none).
 */
export const synthesizeSlideTts = (
  slideId: string,
  mode: 'content' | 'transcript',
): Promise<{ url: string | null; marks: TtsMark[] }> =>
  apiFetch<{ url: string | null; marks: TtsMark[] }>(
    `/api/slides/${slideId}/tts`,
    {
      method: 'POST',
      body: JSON.stringify({ mode }),
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
  intervalMs?: number
}

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
  // ~18s window: enrichment now includes an AI re-rank (and, when enabled, a
  // vision pass), so the image + matched caption can take longer to land than
  // a bare source search.
  const attempts = options.attempts ?? 12
  const intervalMs = options.intervalMs ?? 1500
  let cancelled = false

  const run = async () => {
    for (let i = 0; i < attempts && !cancelled; i++) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
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
