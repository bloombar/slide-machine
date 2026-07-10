/**
 * Background image pickup (IMG-1/GEN-5): enrichment runs server-side off
 * the critical path, so the client re-reads the slide a few times until
 * the image lands or the attempts run out. Failures are silent — the
 * slide simply resolves to its no-image fallback.
 */
import type { Slide } from '@slide-machine/shared'
import { dispatchAction } from './actions'

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
  const attempts = options.attempts ?? 8
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
