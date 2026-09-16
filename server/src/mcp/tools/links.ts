/**
 * Getting an app link for a lecture a write tool holds only an id for.
 *
 * The read tools have the whole deck in hand and its slug with it, so they
 * build links directly (lib/deck-link.ts). A write tool usually does not: an
 * edit is dispatched against slide ids, and the action that runs it answers
 * with the slide rather than the lecture. Fetching the lecture is therefore
 * one extra read per tool call — per *call*, not per edit, which is the whole
 * reason edit_slides batches.
 *
 * Best-effort on purpose. The link is an afterword to work that already
 * happened; a lecture that cannot be read back must not turn a successful edit
 * into a failed tool call, so a failure here costs the link and nothing else.
 */
import type { DeckViewResponse } from '@slide-machine/shared'
import type { ActionCaller } from '../tool'
import { lectureUrl } from '../../lib/deck-link'

/**
 * The full lecture view a write tool holds only an id for — deck, template
 * and all. Best-effort, like `lectureUrlById` below: a lookup that fails
 * must not turn a successful write into a failed tool call, only cost
 * whatever this view would have supplied (the link, or a fit report against
 * the deck's actual template).
 *
 * The caller must declare `deck.get` in its `uses`, or the fenced `call` will
 * refuse it — which is the exposure declaration working as intended.
 */
export const fetchDeckView = async (
  call: ActionCaller,
  deckId: string,
): Promise<DeckViewResponse | undefined> => {
  try {
    return await call<DeckViewResponse>('deck.get', { deckId })
  } catch {
    return undefined
  }
}

/**
 * Where a lecture can be opened, looked up by id, optionally on one slide.
 * Undefined if the lookup fails or no app origin is configured.
 */
export const lectureUrlById = async (
  call: ActionCaller,
  deckId: string,
  slideId?: string,
): Promise<string | undefined> => {
  const view = await fetchDeckView(call, deckId)
  return view ? lectureUrl(view.deck.permalinkSlug, slideId) : undefined
}
