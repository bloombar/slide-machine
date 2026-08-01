/**
 * Display helpers for lectures. Untitled lectures keep an empty title
 * in the data; the interface shows them as "Untitled lecture".
 *
 * These are plain functions, not React components, so they read the
 * i18next singleton's standalone `t` rather than the hook. That means a
 * caller must read them during render (they are not constants), which is
 * how they pick up a language switch.
 */
import type { Deck } from '@slide-machine/shared'
import { t } from '../i18n'

/** The placeholder shown in place of a lecture's missing title. */
export const untitledLecture = (): string => t('lecture.untitled')

export const lectureTitle = (deck: Pick<Deck, 'title'>): string =>
  deck.title.trim() || untitledLecture()
