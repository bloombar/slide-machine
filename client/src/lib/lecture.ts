/**
 * Display helpers for lectures. Untitled lectures keep an empty title
 * in the data; the interface shows them as "Untitled lecture".
 */
import type { Deck } from '@slide-machine/shared'

export const UNTITLED = 'Untitled lecture'

export const lectureTitle = (deck: Pick<Deck, 'title'>): string =>
  deck.title.trim() || UNTITLED
