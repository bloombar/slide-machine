/**
 * Which interface language a visitor gets before we know who they are,
 * and where that choice is remembered (TECH-12).
 *
 * A signed-in account's `User.locale` outranks everything here — see the
 * effect in auth/AuthContext. This module answers the pre-auth question:
 * a choice remembered from a previous visit, then the browser's own
 * languages, then English.
 */
import { LOCALES, type Locale } from '@slide-machine/shared'

/** Where a switch is remembered for the next visit's first paint. */
export const LOCALE_STORAGE_KEY = 'sm.locale'

const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value)

/**
 * Matches a BCP-47 tag against the supported locales on its base subtag,
 * so `fr-CA` and `zh-Hant` resolve to `fr` and `zh`. Returns null when
 * nothing matches — the caller decides what to fall back to.
 */
export const matchLocale = (tag: string | null | undefined): Locale | null => {
  if (!tag) return null
  const base = tag.toLowerCase().split('-')[0]!
  return isLocale(base) ? base : null
}

/** The locale remembered from a previous visit, if still supported. */
export const storedLocale = (): Locale | null => {
  try {
    return matchLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    // Storage can be blocked (private mode, cookie policy). Not fatal —
    // detection just falls through to the browser languages.
    return null
  }
}

/** Remembers a switch. Failing to store it costs the next visit only. */
export const storeLocale = (locale: Locale): void => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Same as above: the locale still applies for this page load
  }
}

/**
 * The locale to boot in: a remembered choice, else the first supported
 * browser language, else English.
 */
export const resolveInitialLocale = (): Locale => {
  const remembered = storedLocale()
  if (remembered) return remembered

  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const tag of tags) {
    const match = matchLocale(tag)
    if (match) return match
  }
  return 'en'
}
