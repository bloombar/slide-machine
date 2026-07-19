/** Unit tests for speakable-text: markdown stripping and content assembly. */
import { describe, it, expect } from 'vitest'
import { slideContentText, stripMarkdown } from './speakable-text'

describe('stripMarkdown', () => {
  it('removes emphasis, code, links, and list/heading markers', () => {
    expect(stripMarkdown('**bold** and _italic_')).toBe('bold and italic')
    expect(stripMarkdown('use `code` here')).toBe('use code here')
    expect(stripMarkdown('see [the docs](https://x.io)')).toBe('see the docs')
    expect(stripMarkdown('# Heading')).toBe('Heading')
    expect(stripMarkdown('- a bullet')).toBe('a bullet')
    expect(stripMarkdown('> a quote')).toBe('a quote')
  })

  it('collapses whitespace and trims', () => {
    expect(stripMarkdown('  a   b \n c ')).toBe('a b c')
  })
})

describe('slideContentText', () => {
  it('joins title, body, bullets, and caption with sentence breaks', () => {
    expect(
      slideContentText({
        title: 'Photosynthesis',
        body: 'Plants make **energy**',
        bullets: ['light reactions', 'dark reactions'],
        caption: 'A chloroplast',
      }),
    ).toBe(
      'Photosynthesis. Plants make energy. light reactions. dark reactions. A chloroplast',
    )
  })

  it('skips empty fields and returns empty for a blank slide', () => {
    expect(slideContentText({ title: 'Just a title' })).toBe('Just a title')
    expect(slideContentText({ title: '', bullets: [] })).toBe('')
  })
})
