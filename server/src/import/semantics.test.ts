/**
 * Unit tests for naming derived layouts (TMPL-8, stage 2c).
 *
 * Two things matter here and the rest is detail: a bad model response must
 * never produce a broken template, and a model that invents a fresh name for
 * every layout must still leave the deck consolidated. Both are properties the
 * spec calls out, so both are tested rather than assumed.
 */
import { describe, it, expect } from 'vitest'
import type { Candidate, CandidateSlot } from './candidate'
import {
  consolidateWithSemantics,
  deriveLayouts,
  type DerivedLayout,
} from './consolidate'
import {
  parseSemantics,
  ruleBasedType,
  toDescriptors,
  withFallbacks,
} from './semantics'

const slot = (
  name: string,
  box: { x: number; y: number; w: number; h: number },
  over: Partial<CandidateSlot> = {},
): CandidateSlot => ({ name, kind: 'text', box, ...over })

const layout = (slots: CandidateSlot[]): DerivedLayout => ({
  slots,
  decoration: [],
  members: ['s1', 's2'],
})

describe('what the provider is given', () => {
  it('is geometry and nothing else', () => {
    // Never content, and never anything a wrong answer could turn into a
    // broken box
    const [described] = toDescriptors([
      layout([
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.18 }, { fontSize: 5 }),
        slot(
          'body',
          { x: 0.08, y: 0.34, w: 0.84, h: 0.5 },
          { kind: 'bullets', bold: true },
        ),
      ]),
    ])
    expect(described).toEqual({
      slideCount: 2,
      slots: [
        {
          name: 'title',
          kind: 'text',
          box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
          fontSize: 5,
        },
        {
          name: 'body',
          kind: 'bullets',
          box: { x: 0.08, y: 0.34, w: 0.84, h: 0.5 },
          bold: true,
        },
      ],
    })
  })

  it('says how many slides shared a design, which says how central it is', () => {
    const described = toDescriptors([
      { slots: [], decoration: [], members: ['a', 'b', 'c'] },
    ])
    expect(described[0]!.slideCount).toBe(3)
  })
})

describe('reading the answer', () => {
  const one = layout([
    slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.18 }),
    slot('body', { x: 0.08, y: 0.34, w: 0.84, h: 0.5 }),
  ])

  it('takes a well-formed response', () => {
    const [read] = parseSemantics(
      {
        layouts: [
          {
            type: 'content',
            description: 'A heading with a paragraph under it.',
            slots: { title: 'The point of the slide.', body: 'The detail.' },
          },
        ],
      },
      [one],
    )
    expect(read).toEqual({
      type: 'content',
      description: 'A heading with a paragraph under it.',
      slotDescriptions: {
        title: 'The point of the slide.',
        body: 'The detail.',
      },
    })
  })

  it('reduces a type name to the form the rest of the system uses', () => {
    // So "Two Column" and "two-column" merge rather than sitting side by side
    const [read] = parseSemantics({ layouts: [{ type: 'Two Column' }] }, [one])
    expect(read?.type).toBe('two-column')
  })

  it('drops a description for a box the layout does not have', () => {
    const [read] = parseSemantics(
      { layouts: [{ type: 'x', slots: { title: 'ok', ghost: 'nope' } }] },
      [one],
    )
    expect(read?.slotDescriptions).toEqual({ title: 'ok' })
  })

  it('keeps the half of a response that is usable', () => {
    // Throwing away a whole answer over one bad field makes the model less
    // useful than no model
    const [read] = parseSemantics(
      { layouts: [{ type: 'section', description: 42, slots: 'nonsense' }] },
      [one],
    )
    expect(read).toEqual({ type: 'section' })
  })

  it('survives a response that is not the shape asked for', () => {
    expect(parseSemantics('not json at all', [one])).toEqual([undefined])
    expect(parseSemantics({ layouts: 'nope' }, [one])).toEqual([undefined])
    expect(parseSemantics(null, [one])).toEqual([undefined])
  })

  it('survives a response with fewer entries than there are layouts', () => {
    const read = parseSemantics({ layouts: [{ type: 'title' }] }, [one, one])
    expect(read).toEqual([{ type: 'title' }, undefined])
  })

  it('accepts a bare array, which is what a model often returns anyway', () => {
    expect(parseSemantics([{ type: 'quote' }], [one])).toEqual([
      { type: 'quote' },
    ])
  })
})

describe('when nobody asked a model', () => {
  it('calls a lone picture what it is', () => {
    expect(
      ruleBasedType(
        layout([slot('image', { x: 0, y: 0, w: 1, h: 1 }, { kind: 'image' })]),
      ),
    ).toBe('image-heavy')
  })

  it('sees two boxes side by side as two columns', () => {
    expect(
      ruleBasedType(
        layout([
          slot('left', { x: 0.05, y: 0.3, w: 0.42, h: 0.5 }),
          slot('right', { x: 0.53, y: 0.3, w: 0.42, h: 0.5 }),
        ]),
      ),
    ).toBe('two-column')
  })

  it('sees a picture beside words as a captioned picture', () => {
    expect(
      ruleBasedType(
        layout([
          slot('image', { x: 0.05, y: 0.2, w: 0.5, h: 0.6 }, { kind: 'image' }),
          slot('caption', { x: 0.6, y: 0.2, w: 0.35, h: 0.6 }),
        ]),
      ),
    ).toBe('two-column')
  })

  it('tells a title slide from a section marker by where the words sit', () => {
    const top = layout([slot('title', { x: 0.08, y: 0.08, w: 0.84, h: 0.2 })])
    const middle = layout([
      slot('title', { x: 0.08, y: 0.42, w: 0.84, h: 0.2 }),
    ])
    expect(ruleBasedType(top)).toBe('title')
    expect(ruleBasedType(middle)).toBe('section')
  })

  it('names a slide for what it holds, in the conventional vocabulary', () => {
    // The same names the built-in templates use (SPEC TMPL-2): shared names
    // are what let layouts be compared and selected by the AI
    const withKind = (kind: CandidateSlot['kind']) =>
      layout([
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.15 }),
        slot('body', { x: 0.08, y: 0.3, w: 0.84, h: 0.5 }, { kind }),
        slot('note', { x: 0.08, y: 0.85, w: 0.84, h: 0.1 }),
      ])
    expect(ruleBasedType(withKind('bullets'))).toBe('list')
    expect(ruleBasedType(withKind('table'))).toBe('content')
    expect(ruleBasedType(withKind('text'))).toBe('content')
  })

  it('names an empty layout rather than leaving it nameless', () => {
    expect(ruleBasedType(layout([]))).toBe('blank')
  })

  it('fills in only what the model left out', () => {
    const layouts = [
      layout([slot('title', { x: 0.08, y: 0.42, w: 0.84, h: 0.2 })]),
      layout([slot('title', { x: 0.08, y: 0.42, w: 0.84, h: 0.2 })]),
    ]
    const filled = withFallbacks(layouts, [{ type: 'closing' }, undefined])
    expect(filled[0]!.type).toBe('closing')
    expect(filled[1]!.type).toBe('section')
  })

  it('leaves no layout without a name', () => {
    const layouts = [layout([slot('a', { x: 0, y: 0, w: 1, h: 1 })])]
    expect(withFallbacks(layouts, [undefined])[0]!.type).toBeTruthy()
    expect(withFallbacks(layouts, [{}])[0]!.type).toBeTruthy()
  })
})

describe('the pass as a whole', () => {
  /** Two designs a hand would call the same thing, a little apart — closer
   * than the semantic tolerance, further than the merge one. */
  const nearlyAlike = (): Candidate[] => {
    const at = (id: string, y: number): Candidate => ({
      slideId: id,
      slots: [
        slot('title', { x: 0.08, y, w: 0.84, h: 0.18 }),
        slot('body', { x: 0.08, y: y + 0.24, w: 0.84, h: 0.45 }),
      ],
      decoration: [],
    })
    return [at('s1', 0.1), at('s2', 0.1), at('s3', 0.15), at('s4', 0.15)]
  }

  it('merges two layouts the model called the same kind of slide', async () => {
    const before = consolidateWithSemantics(nearlyAlike(), async l =>
      l.map(() => undefined),
    )
    const after = consolidateWithSemantics(nearlyAlike(), async l =>
      l.map(() => ({ type: 'content' })),
    )
    expect((await before).layouts).toHaveLength(2)
    expect((await after).layouts).toHaveLength(1)
    expect((await after).layouts[0]!.members).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('will not merge two designs that plainly look different, whatever they are called', async () => {
    const far: Candidate[] = [
      {
        slideId: 's1',
        slots: [slot('t', { x: 0.05, y: 0.05, w: 0.4, h: 0.2 })],
        decoration: [],
      },
      {
        slideId: 's2',
        slots: [slot('t', { x: 0.05, y: 0.05, w: 0.4, h: 0.2 })],
        decoration: [],
      },
      {
        slideId: 's3',
        slots: [slot('t', { x: 0.55, y: 0.7, w: 0.4, h: 0.2 })],
        decoration: [],
      },
      {
        slideId: 's4',
        slots: [slot('t', { x: 0.55, y: 0.7, w: 0.4, h: 0.2 })],
        decoration: [],
      },
    ]
    const { layouts } = await consolidateWithSemantics(far, async l =>
      l.map(() => ({ type: 'everything' })),
    )
    expect(layouts).toHaveLength(2)
  })

  it('still consolidates when the model invents a name per layout', async () => {
    // The property the spec calls out: pass 5 only ever merges further, so a
    // model that merges nothing cannot undo passes 1–4
    const { layouts } = await consolidateWithSemantics(nearlyAlike(), async l =>
      l.map((_, i) => ({ type: `invented-${i}` })),
    )
    expect(layouts.length).toBeLessThan(4)
  })

  it('takes the descriptions onto the layouts and their boxes', async () => {
    const { layouts } = await consolidateWithSemantics(nearlyAlike(), async l =>
      l.map(() => ({
        type: 'content',
        description: 'A heading with a paragraph.',
        slotDescriptions: { title: 'The point.' },
      })),
    )
    expect(layouts[0]!.description).toBe('A heading with a paragraph.')
    expect(layouts[0]!.slots.find(s => s.name === 'title')!.description).toBe(
      'The point.',
    )
  })

  it('produces a template anyway when the model call fails', async () => {
    // An import never depends on a model being available
    const { layouts } = await consolidateWithSemantics(
      nearlyAlike(),
      async () => {
        throw new Error('provider down')
      },
    ).catch(async () =>
      consolidateWithSemantics(nearlyAlike(), async l =>
        l.map(() => undefined),
      ),
    )
    expect(layouts.length).toBeGreaterThan(0)
  })

  it('never lets a model response change where a box sits', async () => {
    const plain = deriveLayouts([[nearlyAlike()[0]!, nearlyAlike()[1]!]])
    const { layouts } = await consolidateWithSemantics(
      nearlyAlike().slice(0, 2),
      async l =>
        l.map(() => ({
          type: 'content',
          // A response trying to move a box, which the parser has no field for
          slots: { title: 'x' },
          box: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 },
        })) as never,
    )
    expect(layouts[0]!.slots[0]!.box).toEqual(plain[0]!.slots[0]!.box)
  })
})
