/**
 * Deck-viewer calls that are not actions (EVAL-7).
 *
 * The action layer requires a signed-in account, and the reader this most
 * needs to reach is the student who followed a permalink without one — so
 * this goes straight to the route, the way translated viewing already does.
 */
import { apiFetch } from './http'

/**
 * Tells the server somebody opened this lecture.
 *
 * Fire-and-forget on purpose. A reader whose opening went uncounted has still
 * read the lecture, and nothing on the page should wait for, or fail on, a
 * statistic — so this resolves either way and the caller need not catch.
 */
export const recordDeckView = async (slug: string): Promise<void> => {
  try {
    await apiFetch<void>(`/api/decks/${slug}/view`, { method: 'POST' })
  } catch {
    // Deliberately silent: the reader is not the person who needs to know.
  }
}
