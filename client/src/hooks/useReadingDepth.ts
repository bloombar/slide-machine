/**
 * Tracks how far a reader gets into a lecture and reports it (EVAL-7 depth):
 * the furthest slide reached, and how long the page was actually visible.
 *
 * Nothing here identifies the reader — only `slug` and the `completionKey`
 * `recordDeckView` handed back for this one opening (see `deck-view.ts`
 * decisions 6-8).
 *
 * Depth is a floor, not an exact figure: a reader who closes the tab
 * mid-lecture may leave no further report at all. So this reports at every
 * moment that might turn out to be the last one it gets — the tab going to
 * the background, the page unloading, leaving the lecture within the app, and
 * a periodic flush in case none of those fire — rather than waiting for a
 * "the reader is done" signal that may never come.
 *
 * Reporting repeatedly is the design, not a fallback. Each report supersedes
 * the last, and the server keeps the larger of what it holds and what
 * arrives, so the final report is the one that counts and an early one costs
 * nothing. A key spent on its first use would invert that — the 30-second
 * flush would win every race and the columns would describe the timer rather
 * than the reading.
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

    // What the last report said. A report that would repeat it is dropped:
    // the server would take it and change nothing, so sending it is pure
    // traffic — and the flush firing every 30 seconds into a backgrounded
    // tab, where neither number can move, is exactly that. A lecture hall
    // shares one address with the rate limiter, so idle tabs must stay quiet.
    let sentSlides = -1
    let sentActiveMs = -1

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
      const slidesReached = maxSlideRef.current
      const activeMs = Math.round(elapsedMs())
      if (slidesReached <= sentSlides && activeMs <= sentActiveMs) return
      sentSlides = slidesReached
      sentActiveMs = activeMs
      reportReadingDepth(slug, { completionKey: key, slidesReached, activeMs })
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
      // Leaving the lecture inside the app fires neither `pagehide` nor
      // `visibilitychange` — the page never unloads — so without this a
      // reader who clicks away to another route reports whatever the last
      // flush saw, or nothing at all if they left inside the first 30
      // seconds. This is that reading's last chance to say how far it got.
      bankVisibleSpan()
      report()
    }
  }, [slug])
}
