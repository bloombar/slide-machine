/**
 * Unit tests for mapping a slide's content onto its layout (EXP-5).
 *
 * The layout is not decided here — deriving the template already did that
 * (TMPL-8), and re-deciding would be a second chance to disagree with the
 * design just built. What is proved here is the filling: that what a box held
 * arrives in the slot it belongs to, in the kind it actually is, and that
 * anything which could not be carried is named rather than quietly lost.
 */
import { describe, it, expect } from 'vitest'
import type { Candidate, CandidateSlot } from './candidate'
import type { SourceElement, SourcePresentation } from './source-presentation'
import { importedSlide } from './slide-content'
import { importSourcePresentation } from './import-presentation'

const box = { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }

/** A box on the slide, holding something. */
const slot = (
  name: string,
  content: Partial<SourceElement> | undefined,
  restored?: CandidateSlot['restored'],
): CandidateSlot =>
  ({
    name,
    box,
    ...(restored ? { restored } : {}),
    ...(content
      ? { content: { id: `${name}-el`, kind: 'text', box, ...content } }
      : {}),
  }) as CandidateSlot

const slide = (slots: CandidateSlot[]): Candidate =>
  ({ slideId: 's1', slots, decoration: [] }) as Candidate

/** Every picture resolves, unless a test says otherwise. */
const stored = (url: string) => `https://cdn.example.com/mine/${url.slice(-8)}`

describe('what a box held arrives in its slot', () => {
  it('places prose as text', () => {
    const result = importedSlide(
      slide([slot('title', { runs: [{ text: 'Photosynthesis' }] })]),
      'title',
      stored,
    )
    expect(result.slots.title).toEqual({
      kind: 'text',
      value: 'Photosynthesis',
    })
  })

  it('joins the runs a sentence was split across', () => {
    // Google splits a line wherever styling changes, so a bolded word alone
    // would otherwise arrive as its own paragraph
    const result = importedSlide(
      slide([
        slot('title', {
          runs: [{ text: 'Light ' }, { text: 'dependent', bold: true }],
        }),
      ]),
      'title',
      stored,
    )
    expect(result.slots.title).toEqual({
      kind: 'text',
      value: 'Light dependent',
    })
  })

  it('places a bulleted box as a list, one item per line', () => {
    const result = importedSlide(
      slide([
        slot('body', {
          bulleted: true,
          runs: [{ text: 'Water' }, { text: 'Carbon dioxide' }],
        }),
      ]),
      'list',
      stored,
    )
    expect(result.slots.body).toEqual({
      kind: 'bullets',
      items: ['Water', 'Carbon dioxide'],
    })
  })

  it('places a table as its rows', () => {
    const result = importedSlide(
      slide([
        slot('data', {
          kind: 'table',
          table: {
            rows: [
              ['a', 'b'],
              ['1', '2'],
            ],
          },
        }),
      ]),
      'table',
      stored,
    )
    expect(result.slots.data).toMatchObject({
      kind: 'table',
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
    })
  })

  it('keeps the layout the design analysis assigned, rather than guessing', () => {
    const result = importedSlide(
      slide([slot('title', { runs: [{ text: 'Hi' }] })]),
      'section-marker',
      stored,
    )
    expect(result.layoutType).toBe('section-marker')
  })
})

describe('a picture the lecture must own', () => {
  it('points at the stored copy, not at Google', () => {
    // EXP-5: images are copied in so the lecture does not depend on the
    // Google file continuing to exist
    const result = importedSlide(
      slide([
        slot('image', {
          kind: 'image',
          imageUrl: 'https://lh3.google.com/abcd1234',
        }),
      ]),
      'picture',
      stored,
    )
    expect(result.slots.image).toMatchObject({
      kind: 'image',
      ref: 'https://cdn.example.com/mine/abcd1234',
    })
  })

  it('is reported rather than written as a broken reference', () => {
    // A ref pointing at a picture that never arrived would render as a hole
    const result = importedSlide(
      slide([
        slot('image', { kind: 'image', imageUrl: 'https://lh3.google.com/x' }),
      ]),
      'picture',
      () => undefined,
    )
    expect(result.slots.image).toBeUndefined()
    expect(result.dropped).toEqual(['image'])
  })
})

describe('a box whose kind only its declaration knows (EXP-8)', () => {
  it('restores a listing, which the shape never said was one', () => {
    // On the slide it is text like any other; being told is the only way
    const result = importedSlide(
      slide([
        slot(
          'example',
          { runs: [{ text: 'print(1)' }] },
          { name: 'example', kind: 'code', label: 'Example' },
        ),
      ]),
      'code',
      stored,
    )
    expect(result.slots.example).toEqual({ kind: 'code', source: 'print(1)' })
  })

  it('keeps a listing’s indentation, which is content and not styling', () => {
    const result = importedSlide(
      slide([
        slot(
          'example',
          { runs: [{ text: 'def f():\n    return 1' }] },
          { name: 'example', kind: 'code', label: 'Example' },
        ),
      ]),
      'code',
      stored,
    )
    expect(result.slots.example).toMatchObject({
      source: 'def f():\n    return 1',
    })
  })

  it('restores a formula as its source, not as typeset words', () => {
    const result = importedSlide(
      slide([
        slot(
          'eq',
          { runs: [{ text: 'E = mc^2' }] },
          { name: 'eq', kind: 'math', label: 'Equation' },
        ),
      ]),
      'formula',
      stored,
    )
    expect(result.slots.eq).toEqual({ kind: 'math', tex: 'E = mc^2' })
  })

  it('beats what the shape looks like, a declared list staying a list', () => {
    const result = importedSlide(
      slide([
        slot(
          'points',
          { runs: [{ text: 'One' }, { text: 'Two' }] },
          { name: 'points', kind: 'bullets', label: 'Points' },
        ),
      ]),
      'list',
      stored,
    )
    expect(result.slots.points).toEqual({
      kind: 'bullets',
      items: ['One', 'Two'],
    })
  })
})

describe('what is left out', () => {
  it('says nothing about a box the author left empty', () => {
    // The design has the box; an empty one is a choice, not a loss
    const result = importedSlide(
      slide([slot('body', undefined)]),
      'list',
      stored,
    )
    expect(result.slots).toEqual({})
    expect(result.dropped).toEqual([])
  })

  it('stores nothing for a box of only whitespace, and calls it no loss', () => {
    // Every slot arrives with its element, so "has content" cannot mean the
    // property exists — a placeholder nobody typed into is a real element
    // with no words. Counting those as dropped reported every untouched box
    // on every slide as material that did not fit
    const result = importedSlide(
      slide([slot('body', { runs: [{ text: '   ' }] })]),
      'list',
      stored,
    )
    expect(result.slots.body).toBeUndefined()
    expect(result.dropped).toEqual([])
  })

  it('says nothing about a deck of untouched placeholders', () => {
    // What a fresh presentation actually looks like: boxes the layout gave
    // it, none of them filled in
    const result = importedSlide(
      slide([
        slot('title', { runs: [] }),
        slot('body', { runs: [{ text: '' }] }),
      ]),
      'title',
      stored,
    )
    expect(result.slots).toEqual({})
    expect(result.dropped).toEqual([])
  })

  it('still reports a picture that existed and would not come', () => {
    // The distinction that matters: material was there and could not be
    // carried, rather than never having been there
    const result = importedSlide(
      slide([
        slot('image', { kind: 'image', imageUrl: 'https://lh3.google.com/x' }),
      ]),
      'picture',
      () => undefined,
    )
    expect(result.dropped).toEqual(['image'])
  })

  it('names every box it could not carry, for the report', () => {
    // EXP-5: material that did not fit is named rather than silently truncated
    const result = importedSlide(
      slide([
        slot('title', { runs: [{ text: 'Kept' }] }),
        slot('image', { kind: 'image', imageUrl: 'https://lh3.google.com/x' }),
      ]),
      'picture',
      () => undefined,
    )
    expect(Object.keys(result.slots)).toEqual(['title'])
    expect(result.dropped).toEqual(['image'])
  })
})

describe('what the presenter said over the slide', () => {
  it('becomes the slide’s narration when notes were given', () => {
    const result = importedSlide(
      slide([slot('title', { runs: [{ text: 'Hi' }] })]),
      'title',
      stored,
      'Today we start with light.',
    )
    expect(result.sourceTranscript).toBe('Today we start with light.')
  })

  it('is absent when there were none, rather than an empty string', () => {
    const result = importedSlide(
      slide([slot('title', { runs: [{ text: 'Hi' }] })]),
      'title',
      stored,
      '   ',
    )
    expect(result.sourceTranscript).toBeUndefined()
  })
})

/**
 * Whether a deck's speaker notes come across (EXP-5).
 *
 * Our own export wrote its notes FROM narration, so they are known to be
 * narration and always return. Anyone else's are the author's to ask for:
 * narration is read aloud (PLAY-2), and "skip this if running late" is not
 * something to say to a room.
 */
describe('the notes on a deck from elsewhere', () => {
  const deck = (): SourcePresentation => ({
    id: 'p1',
    title: 'Untitled',
    theme: {
      background: '#ffffff',
      text: '#111111',
      accent: '#3366cc',
      muted: '#666666',
    },
    layouts: [],
    slides: [
      {
        id: 's1',
        notes: 'Skip this one if running late.',
        elements: [
          {
            id: 's1-t',
            kind: 'text' as const,
            placeholder: 'TITLE',
            box: { x: 0.08, y: 0.1, w: 0.84, h: 0.16 },
            runs: [{ text: 'Photosynthesis' }],
          },
        ],
      },
    ],
  })

  it('stay where they are unless asked for', async () => {
    const { slides } = await importSourcePresentation(deck())
    expect(slides[0]!.sourceTranscript).toBeUndefined()
  })

  it('come across when the author asks', async () => {
    const { slides } = await importSourcePresentation(deck(), {
      importNotes: true,
    })
    expect(slides[0]!.sourceTranscript).toBe('Skip this one if running late.')
  })
})
