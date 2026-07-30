/**
 * Unit tests for the Intl formatting helpers.
 *
 * Russian appears throughout on purpose: it has four plural categories
 * where English has two, so it is the case that the hand-rolled `+ 's'`
 * these replaced could never have got right.
 */
import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
} from './format'

const NOW = new Date('2026-07-11T12:00:00.000Z').getTime()
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

describe('formatRelativeTime', () => {
  it('picks the coarsest unit that still describes the age', () => {
    expect(formatRelativeTime(ago(45), NOW, 'en')).toBe('45 seconds ago')
    expect(formatRelativeTime(ago(3 * 3600), NOW, 'en')).toBe('3 hours ago')
    expect(formatRelativeTime(ago(2 * 604800), NOW, 'en')).toBe('2 weeks ago')
    expect(formatRelativeTime(ago(2 * 31557600), NOW, 'en')).toBe('2 years ago')
  })

  it('reads a fresh timestamp as "now", including a future one', () => {
    expect(formatRelativeTime(ago(3), NOW, 'en')).toBe('now')
    expect(formatRelativeTime(ago(-3600), NOW, 'en')).toBe('now')
  })

  it('names a single unit instead of counting it', () => {
    expect(formatRelativeTime(ago(86400), NOW, 'en')).toBe('yesterday')
  })

  it('applies the locale’s own plural categories', () => {
    // one / few / many — three different endings English cannot express
    expect(formatRelativeTime(ago(21 * 60), NOW, 'ru')).toBe('21 минуту назад')
    expect(formatRelativeTime(ago(22 * 60), NOW, 'ru')).toBe('22 минуты назад')
    expect(formatRelativeTime(ago(25 * 60), NOW, 'ru')).toBe('25 минут назад')
    // Mandarin has no plural distinction at all
    expect(formatRelativeTime(ago(25 * 60), NOW, 'zh')).toBe('25分钟前')
  })
})

/** French groups digits with a narrow no-break space, and separates its
 * currency symbol with one too. Normalizing them keeps the assertion
 * about placement rather than about which space the ICU data ships. */
const spaces = (value: string): string => value.replace(/[\u202f\u00a0]/g, ' ')

describe('formatNumber', () => {
  it('uses the locale’s grouping separator', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
    expect(spaces(formatNumber(1234567, 'fr'))).toBe('1 234 567')
  })
})

describe('formatDate', () => {
  it('formats a date, and a date with a time on request', () => {
    expect(formatDate('2026-07-11T12:00:00.000Z', 'short', 'en-GB')).toBe(
      '11 Jul 2026',
    )
    expect(formatDate('2026-07-11T12:00:00.000Z', 'long', 'en-GB')).toContain(
      '11 Jul 2026',
    )
  })
})

describe('formatFileSize', () => {
  it('scales to the largest unit above 1', () => {
    expect(formatFileSize(512, 'en')).toBe('512 byte')
    expect(formatFileSize(2048, 'en')).toBe('2 kB')
    expect(formatFileSize(5 * 1024 * 1024, 'en')).toBe('5 MB')
  })

  it('clamps a negative size to zero', () => {
    expect(formatFileSize(-10, 'en')).toBe('0 byte')
  })
})

describe('formatCurrency', () => {
  it('places the symbol the way the locale does', () => {
    expect(formatCurrency(12.5, 'USD', 'en-US')).toBe('$12.50')
    expect(spaces(formatCurrency(12.5, 'EUR', 'fr-FR'))).toBe('12,50 €')
  })
})
