/**
 * Unit tests for the locale label helpers. `localeShortLabel` strips the
 * English gloss a picker list needs, leaving the endonym for controls
 * that only show the current choice.
 */
import { describe, it, expect } from 'vitest'
import { LOCALES, LOCALE_LABELS, localeShortLabel } from './locale'

describe('localeShortLabel', () => {
  it('drops the English gloss, keeping the native name', () => {
    expect(localeShortLabel('fr')).toBe('Français')
    expect(localeShortLabel('es')).toBe('Español')
    expect(localeShortLabel('ru')).toBe('Русский')
    expect(localeShortLabel('zh')).toBe('中文')
  })

  it('leaves a label that has no gloss alone', () => {
    // English needs no gloss for an English reader
    expect(localeShortLabel('en')).toBe('English')
  })

  it('returns a non-empty prefix of the full label for every locale', () => {
    for (const locale of LOCALES) {
      const short = localeShortLabel(locale)
      expect(short).not.toBe('')
      // A prefix, so the two can never describe different languages
      expect(LOCALE_LABELS[locale].startsWith(short)).toBe(true)
    }
  })
})
