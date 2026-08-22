/**
 * Unit tests for resolving a lecture's links and images to absolute URLs.
 */
import { describe, it, expect } from 'vitest'
import {
  makeUrlResolver,
  resolveMarkdownUrls,
  extractInlineImages,
} from './assets.mjs'

describe('makeUrlResolver', () => {
  const resolve = makeUrlResolver({
    siteBase: 'https://knowledge.kitchen',
    coursePath: 'content/courses/software-engineering',
    deckName: 'git-and-github',
  })

  /**
   * The sources are published one directory per lecture, so `../assets/x`
   * is relative to the *page* — `/…/slides/git-and-github/` — not to the
   * markdown file. Resolving against the file instead points a directory
   * too high and every image 404s.
   */
  it('resolves a relative path against the lecture’s published page', () => {
    expect(resolve('../assets/git/a.png')).toBe(
      'https://knowledge.kitchen/content/courses/software-engineering/slides/assets/git/a.png',
    )
  })

  it('resolves a site-root path against the site', () => {
    expect(resolve('/content/courses/x/assets/b.png')).toBe(
      'https://knowledge.kitchen/content/courses/x/assets/b.png',
    )
  })

  it('leaves an absolute URL alone', () => {
    expect(resolve('https://example.com/c.png')).toBe(
      'https://example.com/c.png',
    )
    expect(resolve('//cdn.example.com/d.png')).toBe('//cdn.example.com/d.png')
  })

  it('leaves an anchor and a mailto target alone', () => {
    expect(resolve('#section')).toBe('#section')
    expect(resolve('mailto:someone@example.com')).toBe(
      'mailto:someone@example.com',
    )
  })

  it('tolerates a trailing slash on the site base', () => {
    const trailing = makeUrlResolver({
      siteBase: 'https://knowledge.kitchen/',
      coursePath: 'content/courses/c',
      deckName: 'd',
    })
    expect(trailing('/x.png')).toBe('https://knowledge.kitchen/x.png')
  })
})

describe('resolveMarkdownUrls', () => {
  const resolve = url => `https://site${url}`

  it('rewrites both links and images, keeping their labels', () => {
    expect(
      resolveMarkdownUrls('See [docs](/a) and ![alt](/b.png).', resolve),
    ).toBe('See [docs](https://site/a) and ![alt](https://site/b.png).')
  })

  it('keeps a link title', () => {
    expect(resolveMarkdownUrls('[d](/a "T")', resolve)).toBe(
      '[d](https://site/a "T")',
    )
  })

  it('leaves text with no links untouched', () => {
    expect(resolveMarkdownUrls('Plain **text**.', resolve)).toBe(
      'Plain **text**.',
    )
  })
})

describe('extractInlineImages', () => {
  it('lifts an image out of a paragraph, returning the cleaned prose', () => {
    const { text, images } = extractInlineImages(
      'Before.\n\n![A diagram](../a.png)\n\nAfter.',
    )
    expect(images).toEqual([{ alt: 'A diagram', url: '../a.png' }])
    expect(text).toBe('Before.\n\nAfter.')
  })

  it('leaves a link that is not an image in place', () => {
    const { text, images } = extractInlineImages('See [docs](/a).')
    expect(images).toEqual([])
    expect(text).toBe('See [docs](/a).')
  })
})
