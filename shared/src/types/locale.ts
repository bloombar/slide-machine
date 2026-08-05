/**
 * Supported UI and content locales (SPEC TECH-12).
 */
export const LOCALES = ['en', 'fr', 'es', 'ru', 'zh'] as const

export type Locale = (typeof LOCALES)[number]

/** Narrows untrusted input (a request body, a stored string) to a supported
 * locale, so callers never have to cast. */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

/** Display names for language pickers (native name first). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français (French)',
  es: 'Español (Spanish)',
  ru: 'Русский (Russian)',
  zh: '中文 (Mandarin)',
}

/** The endonym alone — "Français", not "Français (French)". The English
 * gloss suits a labelled form field; compact chrome like the nav language
 * menu names each language in itself, which is the word a reader looking
 * for their own is scanning for anyway. Derived rather than a second map,
 * so the two sets of names cannot drift apart. */
export const localeShortLabel = (locale: Locale): string =>
  LOCALE_LABELS[locale].replace(/\s*\(.+\)$/, '')

/** Writing direction per locale, the single source of truth for the
 * document's `dir` attribute. Every launch locale is left-to-right; the
 * map exists so adding a right-to-left one is a data change. */
export const LOCALE_DIRECTION: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  fr: 'ltr',
  es: 'ltr',
  ru: 'ltr',
  zh: 'ltr',
}
