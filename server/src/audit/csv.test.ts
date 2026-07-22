/**
 * Unit tests for the CSV serialization helpers: RFC 4180 escaping,
 * empty-value handling, and the spreadsheet formula-injection guard.
 */
import { describe, it, expect } from 'vitest'
import { csvField, csvRow } from './csv'

describe('csvField', () => {
  it('passes plain values through unchanged', () => {
    expect(csvField('hello')).toBe('hello')
    expect(csvField(42)).toBe('42')
  })

  it('serializes null and undefined as the empty field', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  it('quote-wraps fields containing commas', () => {
    expect(csvField('a,b')).toBe('"a,b"')
  })

  it('quote-wraps and doubles internal quotes', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('quote-wraps fields containing newlines', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvField('line1\rline2')).toBe('"line1\rline2"')
  })

  it('prefixes formula-looking fields so spreadsheets treat them as text', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-1')).toBe("'-1")
    expect(csvField('@cmd')).toBe("'@cmd")
  })

  it('applies both the formula guard and quote-wrapping when needed', () => {
    expect(csvField('=1,2')).toBe('"\'=1,2"')
  })
})

describe('csvRow', () => {
  it('joins escaped fields with commas and ends the line with CRLF', () => {
    expect(csvRow(['a', 'b,c', undefined])).toBe('a,"b,c",\r\n')
  })
})
