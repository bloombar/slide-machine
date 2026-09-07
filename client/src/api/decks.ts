/**
 * Deck-viewer calls that are not actions (EVAL-7).
 *
 * The action layer requires a signed-in account, and the reader this most
 * needs to reach is the student who followed a permalink without one — so
 * this goes straight to the route, the way translated viewing already does.
 */
import type { DeckViewBeaconResponse } from '@slide-machine/shared'
import { apiFetch } from './http'
import { config } from '../config'

/**
 * Tells the server somebody opened this lecture, and returns the single-use
 * key that opening can later be completed with (EVAL-7 depth) — null when
 * the opening was not recorded, so there is nothing to complete.
 *
 * Fire-and-forget on purpose. A reader whose opening went uncounted has still
 * read the lecture, and nothing on the page should wait for, or fail on, a
 * statistic — so this resolves either way and the caller need not catch.
 */
export const recordDeckView = async (
  slug: string,
): Promise<{ completionKey: string | null }> => {
  try {
    const res = await apiFetch<DeckViewBeaconResponse | undefined>(
      `/api/decks/${slug}/view`,
      { method: 'POST' },
    )
    return { completionKey: res?.completionKey ?? null }
  } catch {
    // Deliberately silent: the reader is not the person who needs to know.
    return { completionKey: null }
  }
}

/**
 * Reports how far a reader got in an opening `recordDeckView` already
 * started (EVAL-7 depth): the furthest slide reached and how long the page
 * was actually visible. `useReadingDepth` is the caller — see there for when
 * this fires.
 *
 * Uses `navigator.sendBeacon` where available so the report survives the tab
 * closing, which a normal fetch cannot promise; falls back to a keepalive
 * fetch (older browsers, and jsdom in tests, have no sendBeacon). Either way
 * this is fire-and-forget, the same discipline as `recordDeckView`: no
 * response is awaited or read, and nothing here can reject into the caller.
 */
export const reportReadingDepth = (
  slug: string,
  body: { completionKey: string; slidesReached: number; activeMs: number },
): void => {
  const url = `${config.apiBaseUrl}/api/decks/${slug}/view/complete`
  const payload = JSON.stringify(body)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      url,
      new Blob([payload], { type: 'application/json' }),
    )
    if (sent) return
  }
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Deliberately silent: the reader is not the person who needs to know.
  })
}
