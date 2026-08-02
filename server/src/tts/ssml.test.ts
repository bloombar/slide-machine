/**
 * Unit tests for the SSML mark builder: a mark per phrase, char offsets into
 * the plain text, and XML escaping so arbitrary narration is safe.
 */
import { describe, expect, it } from 'vitest'
import { buildMarkedSsml, escapeSsml } from './ssml'

describe('escapeSsml', () => {
  it('escapes the five XML characters', () => {
    expect(escapeSsml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    )
  })
})

describe('buildMarkedSsml', () => {
  it('inserts a mark per phrase with plain-text char offsets', () => {
    const text = 'Hello there. How are you?'
    const { ssml, marks } = buildMarkedSsml(text)
    expect(marks).toEqual([
      { name: 'm0', charOffset: 0 },
      { name: 'm1', charOffset: 13 },
    ])
    // Offsets index the plain text (where stroke anchors live).
    expect(text.slice(marks[1]!.charOffset)).toBe('How are you?')
    expect(ssml.startsWith('<speak>')).toBe(true)
    expect(ssml.endsWith('</speak>')).toBe(true)
    expect(ssml).toContain('<mark name="m0"/>Hello there.')
    expect(ssml).toContain('<mark name="m1"/>How are you?')
  })

  it('escapes phrase text inside the SSML', () => {
    const { ssml } = buildMarkedSsml('Tom & Jerry <3.')
    expect(ssml).toContain('Tom &amp; Jerry &lt;3.')
  })

  it('yields bare <speak> and no marks for empty text', () => {
    expect(buildMarkedSsml('   ')).toEqual({
      ssml: '<speak></speak>',
      marks: [],
      billedCharacters: 15,
    })
  })
})

/**
 * Google bills SSML by character *including* its tags, with `<mark>` the one
 * exception. Getting this wrong bills users for markup they never wrote — or,
 * worse, silently under-counts what we are actually paying for.
 */
describe('buildMarkedSsml billing', () => {
  it('counts the markup it sends but never the marks', () => {
    const { ssml, billedCharacters } = buildMarkedSsml('Hello there. Bye now.')
    const markChars = '<mark name="m0"/>'.length + '<mark name="m1"/>'.length
    expect(billedCharacters).toBe(ssml.length - markChars)
    // The wrapper and the phrase-separating spaces are billed, so the count
    // sits above the plain text it came from.
    expect(billedCharacters).toBeGreaterThan('Hello there. Bye now.'.length)
  })

  it('counts an escaped entity at its expanded length', () => {
    // Same length as plain text, but '&' is sent as '&amp;' — so it costs four
    // characters more on the invoice than it does on the slide.
    const plain = buildMarkedSsml('Tom v Jerry.').billedCharacters
    const escaped = buildMarkedSsml('Tom & Jerry.').billedCharacters
    expect(escaped).toBe(plain + 4)
  })
})
