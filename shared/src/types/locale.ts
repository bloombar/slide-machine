/**
 * Supported UI and content locales (SPEC TECH-12).
 */
export const LOCALES = ['en', 'fr', 'es', 'ru', 'zh'] as const

export type Locale = (typeof LOCALES)[number]
