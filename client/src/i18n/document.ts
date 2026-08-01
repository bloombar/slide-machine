/**
 * Keeps the document element in step with the active interface language:
 * `lang` for assistive technology, spell-checking and hyphenation, `dir`
 * for writing direction.
 *
 * Direction comes from the shared LOCALE_DIRECTION map rather than a
 * check here, so adding a right-to-left locale is a data change (TECH-12
 * asks only that we not preclude one).
 */
import { LOCALE_DIRECTION, type Locale } from '@slide-machine/shared'

export const applyDocumentLocale = (locale: Locale): void => {
  const root = document.documentElement
  root.lang = locale
  root.dir = LOCALE_DIRECTION[locale] ?? 'ltr'
}
