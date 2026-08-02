/**
 * Which interface language a visitor gets, and where an explicit choice
 * is remembered (TECH-12).
 *
 * Nothing is stored until a language is explicitly picked. Absent a
 * choice the browser's own languages decide, re-matched against LOCALES
 * on every load — so a language added to the app reaches everyone who
 * never picked one, without migrating stored accounts or storage keys.
 *
 * Precedence: a signed-in account's `User.locale` (see auth/AuthContext),
 * then a choice remembered in this browser, then the browser's languages,
 * then English.
 */
import { LOCALES, type Locale } from '@slide-machine/shared'

/** Where an explicit choice is remembered for the next visit. */
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

/**
 * Subscribers to the remembered choice, so a component reading it stays
 * in step with a switch made elsewhere in the tree — including one that
 * leaves the effective language unchanged (picking "Default" when the
 * browser asks for the language already showing), which i18next itself
 * has no event for.
 */
const listeners = new Set<() => void>()

/** Subscribes to changes in the remembered choice; returns an unsubscribe. */
export const subscribeStoredLocale = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
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

const notify = (): void => {
  for (const listener of listeners) listener()
}

/** Remembers a choice. Failing to store it costs the next visit only. */
export const storeLocale = (locale: Locale): void => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Same as above: the locale still applies for this page load
  }
  notify()
}

/** Forgets the choice, so detection decides again from the next load. */
export const clearStoredLocale = (): void => {
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY)
  } catch {
    // Same as above
  }
  notify()
}

/**
 * The language the browser asks for, matched against the locales
 * supported right now. English when none of them is.
 */
export const detectBrowserLocale = (): Locale => {
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const tag of tags) {
    const match = matchLocale(tag)
    if (match) return match
  }
  return 'en'
}

/**
 * The locale to boot in: a remembered choice, else what the browser
 * asks for.
 */
export const resolveInitialLocale = (): Locale =>
  storedLocale() ?? detectBrowserLocale()
