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
} from '@slide-machine/shared'
import { apiFetch } from './http'
import { dispatchAction } from './actions'

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
