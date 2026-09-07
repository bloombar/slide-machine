/**
 * Tracks how far a reader gets into a lecture and reports it (EVAL-7 depth):
 * the furthest slide reached, and how long the page was actually visible.
 *
 * Nothing here identifies the reader — only `slug` and the single-use
 * `completionKey` `recordDeckView` handed back for this one opening (see
 * `deck-view.ts` decision 6). Depth is a floor, not an exact figure: a
 * reader who closes the tab mid-lecture may leave no further report at all,
 * so this reports at the moments most likely to be the last one it gets —
 * the tab going to the background, the page unloading, and (in case neither
 * fires, e.g. the browser is killed outright) a periodic flush — rather than
 * waiting for a "the reader is done" signal that may never come.
 *
 * `activeMs` only ever accrues while `document.visibilityState` is
 * 'visible': a backgrounded tab, a locked laptop, a lecture left open
 * overnight are not reading, and counting them would make depth a measure
 * of forgetfulness instead.
 */
import { useEffect, useRef } from 'react'
import { reportReadingDepth } from '../api/decks'

/** How often the hook reports on its own, so a hard close — one that fires
 * neither `visibilitychange` nor `pagehide` — still leaves a floor. */
const FLUSH_INTERVAL_MS = 30_000

export function useReadingDepth(
  slug: string | undefined,
  completionKey: string | null,
  slideIndex: number,
): void {
  // Mirrored into a ref rather than read directly: the listeners below are
  // set up once per opening (they must not tear down and rebuild on every
  // slide change, which would lose the accumulated visible time), so they
  // need a way to see the latest key without being in that effect's deps.
  const completionKeyRef = useRef(completionKey)
  useEffect(() => {
    completionKeyRef.current = completionKey
  }, [completionKey])

  // The furthest slide reached, one-indexed like the server column it feeds
  // ("reached 1 slide", not "reached index 0") — and, within one opening,
  // only ever grows. Reset explicitly on a slug change rather than trusting
  // effect ordering against the timer effect below, which also resets on
  // slug but must not on a plain slide move.
  const maxSlideRef = useRef(0)
  const openingRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (openingRef.current !== slug) {
      openingRef.current = slug
      maxSlideRef.current = 0
    }
    maxSlideRef.current = Math.max(maxSlideRef.current, slideIndex + 1)
  }, [slug, slideIndex])

  useEffect(() => {
    if (!slug) return

    // Visible time is tracked as banked time from earlier spans plus
    // whatever has elapsed since the current span began (null while
    // hidden) — local to this opening, so a new lecture starts its clock
    // fresh rather than inheriting a previous one's total.
    let accumulatedMs = 0
    let visibleSince =
      document.visibilityState === 'visible' ? Date.now() : null

    const elapsedMs = (): number =>
      accumulatedMs + (visibleSince !== null ? Date.now() - visibleSince : 0)

    const bankVisibleSpan = (): void => {
      if (visibleSince === null) return
      accumulatedMs += Date.now() - visibleSince
      visibleSince = null
    }

    const report = (): void => {
      const key = completionKeyRef.current
      // No key means this opening was never recorded (rate-limited, or a
      // write failure) — there is nothing to complete.
      if (!key) return
      reportReadingDepth(slug, {
        completionKey: key,
        slidesReached: maxSlideRef.current,
        activeMs: Math.round(elapsedMs()),
      })
    }

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        bankVisibleSpan()
        report()
      } else {
        visibleSince = Date.now()
      }
    }
    const onPageHide = (): void => {
      bankVisibleSpan()
      report()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    const flush = window.setInterval(report, FLUSH_INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      window.clearInterval(flush)
    }
  }, [slug])
}
