/**
 * Unit tests for pre-auth locale resolution: what an anonymous visitor
 * gets, and in what order the signals are consulted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LOCALE_STORAGE_KEY,
  matchLocale,
  resolveInitialLocale,
  storeLocale,
  storedLocale,
} from './detect'

/** Replaces navigator.languages for one test. */
const withLanguages = (languages: string[]) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] ?? 'en')
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('matchLocale', () => {
  it('accepts a supported tag as-is', () => {
    expect(matchLocale('fr')).toBe('fr')
  })

  it('matches a regional tag on its base subtag', () => {
    expect(matchLocale('fr-CA')).toBe('fr')
    expect(matchLocale('zh-Hant-TW')).toBe('zh')
    expect(matchLocale('ES-mx')).toBe('es')
  })

  it('rejects an unsupported or absent tag', () => {
    expect(matchLocale('de')).toBeNull()
    expect(matchLocale('')).toBeNull()
    expect(matchLocale(null)).toBeNull()
    expect(matchLocale(undefined)).toBeNull()
  })
})

describe('storedLocale', () => {
  it('round-trips a stored choice', () => {
    storeLocale('ru')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru')
    expect(storedLocale()).toBe('ru')
  })

  it('ignores a stored value that is no longer supported', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de')
    expect(storedLocale()).toBeNull()
  })

  it('survives storage being unavailable', () => {
    const blocked = new Error('blocked')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw blocked
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw blocked
    })
    expect(storedLocale()).toBeNull()
    expect(() => storeLocale('fr')).not.toThrow()
  })
})

describe('resolveInitialLocale', () => {
  it('prefers a remembered choice over the browser', () => {
    withLanguages(['fr-FR'])
    storeLocale('es')
    expect(resolveInitialLocale()).toBe('es')
  })

  it('falls back to the first supported browser language', () => {
    withLanguages(['de-DE', 'ru-RU', 'fr-FR'])
    expect(resolveInitialLocale()).toBe('ru')
  })

  it('falls back to English when nothing matches', () => {
    withLanguages(['de-DE', 'it-IT'])
    expect(resolveInitialLocale()).toBe('en')
  })

  it('reads navigator.language when the list is empty', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([])
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
    expect(resolveInitialLocale()).toBe('zh')
  })
})
