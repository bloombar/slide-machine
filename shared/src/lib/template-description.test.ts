import { describe, expect, it } from 'vitest'
import {
  TEMPLATE_DESCRIPTION_CHARS,
  templateDescription,
} from './template-description'

describe('templateDescription', () => {
  it('returns empty string when there are no instructions', () => {
    expect(templateDescription(undefined)).toBe('')
    expect(templateDescription('')).toBe('')
    expect(templateDescription('   \n  ')).toBe('')
  })

  it('returns text at exactly the limit whole, with no ellipsis', () => {
    const text = 'a'.repeat(TEMPLATE_DESCRIPTION_CHARS - 2) + ' b'
    expect(text.length).toBe(TEMPLATE_DESCRIPTION_CHARS)
    expect(templateDescription(text)).toBe(text)
  })

  it('cuts longer text at a word boundary and adds an ellipsis', () => {
    const word = 'lorem '
    const text = word.repeat(40) // well over the limit, all word breaks
    const result = templateDescription(text)
    expect(result.endsWith('…')).toBe(true)
    // The total, ellipsis included, never exceeds the limit.
    expect(result.length).toBeLessThanOrEqual(TEMPLATE_DESCRIPTION_CHARS)
    // The cut never splits a word: strip the ellipsis and the remainder is
    // whole words from the source.
    const withoutEllipsis = result.slice(0, -1)
    expect(text.startsWith(withoutEllipsis)).toBe(true)
    expect(text[withoutEllipsis.length]).toBe(' ')
  })

  it('cuts mid-word when there is no space to break on', () => {
    const text = 'x'.repeat(TEMPLATE_DESCRIPTION_CHARS + 50)
    const result = templateDescription(text)
    expect(result).toBe('x'.repeat(TEMPLATE_DESCRIPTION_CHARS - 1) + '…')
    expect(result.length).toBeLessThanOrEqual(TEMPLATE_DESCRIPTION_CHARS)
  })

  it('hard-cuts rather than break at a word boundary too early in the budget', () => {
    // The only space sits at index 2 — far short of half the (159-char)
    // budget — so breaking there would produce "Hi…", which says almost
    // nothing. A hard cut at the budget is preferred instead.
    const text = 'Hi ' + 'z'.repeat(300)
    const result = templateDescription(text)
    expect(result).toBe(text.slice(0, TEMPLATE_DESCRIPTION_CHARS - 1) + '…')
    expect(result.length).toBeLessThanOrEqual(TEMPLATE_DESCRIPTION_CHARS)
  })

  it('collapses whitespace and newlines before measuring length', () => {
    const text = 'Audience:\n  elementary school\n\tRegister:   friendly'
    expect(templateDescription(text)).toBe(
      'Audience: elementary school Register: friendly',
    )
  })
})
