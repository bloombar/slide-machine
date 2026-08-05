/**
 * Tests for the translation overlay (SHARE-2): translated fields win, missing
 * ones fall back to the author's text, and the source slide is never mutated.
 */
import { describe, expect, it } from 'vitest'
import { deckSourceLocale, overlaySlideTranslation } from './slide-translation'

const slide = {
  id: 's1',
  title: 'Original title',
  body: 'Original body',
  bullets: ['one', 'two'],
  caption: 'Original caption',
}

describe('overlaySlideTranslation', () => {
  it('replaces every field the translation covers', () => {
    expect(
      overlaySlideTranslation(slide, {
        title: 'Titre',
        body: 'Corps',
        bullets: ['un', 'deux'],
        caption: 'Légende',
      }),
    ).toEqual({
      id: 's1',
      title: 'Titre',
      body: 'Corps',
      bullets: ['un', 'deux'],
      caption: 'Légende',
    })
  })

  it('falls back to the original for fields the translation misses', () => {
    const out = overlaySlideTranslation(slide, { title: 'Titre' })
    expect(out.title).toBe('Titre')
    expect(out.body).toBe('Original body')
    expect(out.bullets).toEqual(['one', 'two'])
    expect(out.caption).toBe('Original caption')
  })

  it('returns the slide untouched when there is no entry', () => {
    expect(overlaySlideTranslation(slide, undefined)).toBe(slide)
  })

  it('never mutates the stored slide', () => {
    const original = { ...slide, bullets: [...slide.bullets] }
    overlaySlideTranslation(slide, { title: 'Titre', bullets: ['un'] })
    expect(slide).toEqual(original)
  })

  it('keeps fields the overlay does not know about', () => {
    const withExtras = { ...slide, layoutType: 'content', imageRef: 'x.png' }
    const out = overlaySlideTranslation(withExtras, { title: 'Titre' })
    expect(out.layoutType).toBe('content')
    expect(out.imageRef).toBe('x.png')
  })
})

describe('deckSourceLocale', () => {
  it("prefers the lecture's own language", () => {
    expect(deckSourceLocale('ru', 'fr')).toBe('ru')
  })

  it('falls back to the project language', () => {
    expect(deckSourceLocale(undefined, 'fr')).toBe('fr')
  })

  it('falls back to English when neither is set', () => {
    expect(deckSourceLocale(undefined, undefined)).toBe('en')
  })
})
