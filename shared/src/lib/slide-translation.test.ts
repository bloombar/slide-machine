/**
 * Tests for the translation overlay (SHARE-2): translated slots win, missing
 * ones fall back to the author's text, the slot map is what actually gets
 * replaced, and the source slide is never mutated.
 */
import { describe, expect, it } from 'vitest'
import { deckSourceLocale, overlaySlideTranslation } from './slide-translation'
import type { SlideTranslationEntry, SlotValue } from '../types/deck'

const slide = {
  id: 's1',
  title: 'Original title',
  body: 'Original body',
  bullets: ['one', 'two'],
  caption: 'Original caption',
}

/** An entry covering the conventional slots, the way the server writes one. */
const entry = (slots: Record<string, SlotValue>): SlideTranslationEntry => ({
  slots: slots as SlideTranslationEntry['slots'],
})

describe('overlaySlideTranslation', () => {
  it('replaces every field the translation covers', () => {
    expect(
      overlaySlideTranslation(
        slide,
        entry({
          title: { kind: 'text', value: 'Titre' },
          body: { kind: 'text', value: 'Corps' },
          bullets: { kind: 'bullets', items: ['un', 'deux'] },
          caption: { kind: 'text', value: 'Légende' },
        }),
      ),
    ).toEqual({
      id: 's1',
      title: 'Titre',
      body: 'Corps',
      bullets: ['un', 'deux'],
      caption: 'Légende',
    })
  })

  it('falls back to the original for slots the translation misses', () => {
    const out = overlaySlideTranslation(
      slide,
      entry({ title: { kind: 'text', value: 'Titre' } }),
    )
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
    overlaySlideTranslation(
      slide,
      entry({
        title: { kind: 'text', value: 'Titre' },
        bullets: { kind: 'bullets', items: ['un'] },
      }),
    )
    expect(slide).toEqual(original)
  })

  it('keeps fields the overlay does not know about', () => {
    const withExtras = { ...slide, layoutType: 'content', imageRef: 'x.png' }
    const out = overlaySlideTranslation(
      withExtras,
      entry({ title: { kind: 'text', value: 'Titre' } }),
    )
    expect(out.layoutType).toBe('content')
    expect(out.imageRef).toBe('x.png')
  })

  describe('the slot map', () => {
    const withSlots = {
      ...slide,
      slots: {
        title: { kind: 'text', value: 'Original title' },
        notes: { kind: 'text', value: 'Author notes' },
        sample: { kind: 'code', source: 'print(1)', language: 'python' },
      } as Record<string, SlotValue>,
    }

    it('replaces boxes by name, whatever the author called them', () => {
      const out = overlaySlideTranslation(
        withSlots,
        entry({ notes: { kind: 'text', value: 'Notes de cours' } }),
      )
      expect(out.slots?.notes).toEqual({
        kind: 'text',
        value: 'Notes de cours',
      })
    })

    it('leaves a box the entry does not cover alone', () => {
      const out = overlaySlideTranslation(
        withSlots,
        entry({ title: { kind: 'text', value: 'Titre' } }),
      )
      expect(out.slots?.sample).toEqual({
        kind: 'code',
        source: 'print(1)',
        language: 'python',
      })
    })

    it('ignores a translation whose kind no longer matches the slide', () => {
      // A stale entry from before the box changed kind must not overwrite
      // code with a translation of the prose that used to live there.
      const out = overlaySlideTranslation(
        withSlots,
        entry({ sample: { kind: 'text', value: 'imprimer(1)' } }),
      )
      expect(out.slots?.sample).toEqual({
        kind: 'code',
        source: 'print(1)',
        language: 'python',
      })
    })

    it('ignores a translation for a box the slide no longer has', () => {
      const out = overlaySlideTranslation(
        withSlots,
        entry({ gone: { kind: 'text', value: 'Disparu' } }),
      )
      expect(out.slots).not.toHaveProperty('gone')
    })

    it('carries a table across cell by cell', () => {
      const table = {
        id: 's2',
        slots: {
          grid: {
            kind: 'table',
            header: ['Word', 'Meaning'],
            rows: [['dog', 'animal']],
          },
        } as Record<string, SlotValue>,
      }
      const out = overlaySlideTranslation(
        table,
        entry({
          grid: {
            kind: 'table',
            header: ['Mot', 'Sens'],
            rows: [['chien', 'animal']],
          },
        }),
      )
      expect(out.slots?.grid).toEqual({
        kind: 'table',
        header: ['Mot', 'Sens'],
        rows: [['chien', 'animal']],
      })
    })
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
