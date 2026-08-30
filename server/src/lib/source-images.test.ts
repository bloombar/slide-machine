/**
 * Unit tests for finding and labelling the empty picture boxes on a slide.
 *
 * The background search itself needs a database and a network, so it is
 * covered by the integration suite; what matters here is that the right boxes
 * are called empty and that a slide always ends up with something to search
 * for — including the picture-led layout, whose only text is its caption.
 */
import { describe, it, expect } from 'vitest'
import type { HydratedDocument } from 'mongoose'
import type { SlideDb } from '../models/slide'
import type { DeckTemplate } from '../templates/versions'
import {
  applyImageKeywords,
  emptyImageSlotsOf,
  imageSearchTerms,
} from './source-images'

/** A template shaped like the built-in ones, plus one an author built. */
const template = {
  theme: {},
  layouts: [
    {
      type: 'content',
      label: 'Content',
      purpose: 'Prose',
      slots: [
        { name: 'title', kind: 'text' },
        { name: 'body', kind: 'text' },
      ],
    },
    {
      type: 'image-heavy',
      label: 'Image',
      purpose: 'A picture',
      slots: [
        { name: 'image', kind: 'image' },
        { name: 'caption', kind: 'text' },
      ],
    },
    {
      type: 'two-column',
      label: 'Two column',
      purpose: 'Prose and a picture',
      slots: [
        { name: 'title', kind: 'text' },
        { name: 'body', kind: 'text' },
        { name: 'image', kind: 'image' },
      ],
    },
    {
      type: 'two-photos',
      label: 'Two photos',
      purpose: 'Two pictures',
      slots: [
        { name: 'title', kind: 'text' },
        { name: 'photo-left', kind: 'image' },
        { name: 'photo-right', kind: 'image' },
      ],
    },
  ],
} as unknown as DeckTemplate

/** A slide document, only as far as these helpers read one. */
const slide = (fields: Partial<SlideDb>): HydratedDocument<SlideDb> =>
  ({ layoutType: 'content', ...fields }) as HydratedDocument<SlideDb>

describe('emptyImageSlotsOf', () => {
  it('finds nothing on a layout with no picture box', () => {
    expect(
      emptyImageSlotsOf(slide({ layoutType: 'content' }), template),
    ).toEqual([])
  })

  it('finds the empty picture box on an image layout', () => {
    expect(
      emptyImageSlotsOf(slide({ layoutType: 'image-heavy' }), template),
    ).toEqual(['image'])
  })

  it('skips a box that already holds a picture', () => {
    expect(
      emptyImageSlotsOf(
        slide({
          layoutType: 'image-heavy',
          slots: { image: { kind: 'image', ref: 'https://x.test/a.png' } },
        } as Partial<SlideDb>),
        template,
      ),
    ).toEqual([])
  })

  /**
   * A slide that already carries one picture still has the other box empty;
   * asking of the slide as a whole would leave it that way for good.
   */
  it('reports only the empty boxes of a layout with several', () => {
    expect(
      emptyImageSlotsOf(
        slide({
          layoutType: 'two-photos',
          slots: {
            'photo-left': { kind: 'image', ref: 'https://x.test/a.png' },
          },
        } as Partial<SlideDb>),
        template,
      ),
    ).toEqual(['photo-right'])
  })

  /** The legacy top-level field still counts as a filled `image` box. */
  it('honours a picture stored the old way', () => {
    expect(
      emptyImageSlotsOf(
        slide({ layoutType: 'image-heavy', imageRef: 'https://x.test/a.png' }),
        template,
      ),
    ).toEqual([])
  })
})

describe('applyImageKeywords', () => {
  it('mines the slide’s own words and sets them on it', () => {
    const doc = slide({ title: 'Waterfall process models' })
    expect(applyImageKeywords(doc)).toEqual(['waterfall', 'process', 'models'])
    expect(doc.imageKeywords).toEqual(['waterfall', 'process', 'models'])
  })

  /** The picture-led layout has no text but its caption. */
  it('mines the caption of a slide that has nothing else', () => {
    const doc = slide({
      layoutType: 'image-heavy',
      caption: 'Iterative lifecycle diagram',
    })
    expect(applyImageKeywords(doc)).toEqual([
      'iterative',
      'lifecycle',
      'diagram',
    ])
  })

  /** Terms already on the slide are the author's or the model's intent. */
  it('leaves keywords the slide already carries alone', () => {
    const doc = slide({ title: 'Something else', imageKeywords: ['chosen'] })
    expect(applyImageKeywords(doc)).toEqual(['chosen'])
    expect(doc.imageKeywords).toEqual(['chosen'])
  })

  it('returns nothing for a slide with no words at all', () => {
    const doc = slide({ layoutType: 'image-heavy' })
    expect(applyImageKeywords(doc)).toEqual([])
    expect(doc.imageKeywords).toBeUndefined()
  })
})

/**
 * What a slide's pictures are searched for (IMG-1).
 *
 * The distinction that matters is "no keywords" versus "no picture wanted".
 * The first used to end enrichment before it started, leaving a picture box
 * empty for good on a layout that exists to hold one; the second must keep
 * doing exactly that.
 */
describe('imageSearchTerms', () => {
  const slide = {
    title: 'The Chloroplast',
    body: 'Where photosynthesis happens.',
  }

  it('uses the model’s keywords when it wrote some', () => {
    expect(imageSearchTerms({ keywords: ['chloroplast'] }, slide)).toEqual([
      'chloroplast',
    ])
  })

  it('falls back to the slide’s own words when it wrote none', () => {
    // Asking for a picture without saying what of is not a request for no
    // picture — the title says what the slide is about
    expect(imageSearchTerms({ keywords: [] }, slide)).toEqual(['chloroplast'])
  })

  it('searches for nothing when the model said text-only', () => {
    expect(imageSearchTerms({ keywords: [], none: true }, slide)).toEqual([])
  })

  it('searches for nothing when there is no guidance at all', () => {
    expect(imageSearchTerms(undefined, slide)).toEqual([])
  })

  it('is empty for a slide with no words to mine', () => {
    // Nothing to search for, and the client must not be left polling for a
    // picture that is never going to be sent
    expect(imageSearchTerms({ keywords: [] }, {})).toEqual([])
  })
})
