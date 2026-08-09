/**
 * Unit tests for the cap-notification catalog (BILL-8).
 *
 * Mostly parity: this is the one place the server holds translated strings, so
 * the failure mode is a locale quietly missing a key and rendering `undefined`
 * into somebody's inbox. The client bundles have a parity test for the same
 * reason (TECH-12); this is its server-side counterpart.
 */
import { describe, it, expect } from 'vitest'
import { LOCALES, type UsageMetric } from '@slide-machine/shared'
import { capMessages, CAP_MESSAGE_KEYS } from './cap-messages'

/** Every metric the plans config can cap, so a new one cannot ship unnamed. */
const METRICS: UsageMetric[] = [
  'aiTokens',
  'sttMinutes',
  'diarizationMinutes',
  'ttsCharacters',
  'ttsPremiumCharacters',
  'aiImages',
  'imageLookups',
  'importMb',
  'exports',
  'translationCharacters',
  'audioStorageMb',
  'audienceTtsCharacters',
  'audienceLocales',
]

describe('locale parity', () => {
  it.each(LOCALES)('%s defines every message', locale => {
    const { t } = capMessages(locale)
    for (const key of CAP_MESSAGE_KEYS) {
      const message = t(key)
      expect(message, `${locale} is missing ${key}`).toBeTruthy()
      expect(message).not.toContain('undefined')
    }
  })

  it.each(LOCALES)('%s names every metered resource', locale => {
    const { metricName } = capMessages(locale)
    for (const metric of METRICS) {
      // Plain language, never the identifier — an instructor reads
      // "Narration", not "ttsCharacters" (BILL-8).
      expect(metricName(metric), `${locale} is missing ${metric}`).toBeTruthy()
      expect(metricName(metric)).not.toBe(metric)
    }
  })
})

describe('choosing a language', () => {
  it('writes to a reader in the language they chose', () => {
    expect(capMessages('fr').t('greeting', { name: 'Ada' })).toBe(
      'Bonjour Ada,',
    )
  })

  it('falls back to English for an account that never chose one', () => {
    // Every account has an inbox; only some have a stored preference. An
    // English notification is far better than none.
    expect(capMessages(undefined).locale).toBe('en')
    expect(capMessages('').locale).toBe('en')
  })

  it('falls back for a language we do not have messages for', () => {
    expect(capMessages('de').locale).toBe('en')
  })
})

describe('interpolation', () => {
  it('substitutes named values', () => {
    expect(
      capMessages('en').t('line.used', {
        metric: 'Narration',
        used: '1,000',
        cap: '60,000',
      }),
    ).toBe('  • Narration — 1,000 of 60,000 used')
  })

  it('renders a missing value as nothing rather than leaving braces', () => {
    // A hole in a sentence reads as a bug; `{{name}}` reads as a broken app.
    expect(capMessages('en').t('greeting')).toBe('Hi ,')
  })
})
