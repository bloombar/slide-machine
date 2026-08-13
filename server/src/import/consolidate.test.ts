/**
 * Unit tests for turning many slides into few layouts (TMPL-8, stage 2b).
 *
 * The thing worth testing here is not that clustering runs — it is that the
 * output is TIDIER than the input. A deck of twelve hand-built slides should
 * not produce twelve layouts, and the layouts it does produce should have a
 * grid the original never had.
 */
import { describe, it, expect } from 'vitest'
import type { Candidate, CandidateSlot } from './candidate'
import {
  consolidateCandidates,
  distance,
  MERGE_TOLERANCE,
  SNAP_TOLERANCE,
} from './consolidate'

const slot = (
  name: string,
  box: { x: number; y: number; w: number; h: number },
  over: Partial<CandidateSlot> = {},
): CandidateSlot => ({ name, kind: 'text', box, ...over })

/** A title-and-body slide, optionally nudged the way a hand nudges one. */
const slide = (
  id: string,
  jitter = 0,
  over: Partial<Candidate> = {},
): Candidate => ({
  slideId: id,
  slots: [
    slot('title', { x: 0.08 + jitter, y: 0.1 + jitter, w: 0.84, h: 0.18 }),
    slot('body', { x: 0.08 + jitter, y: 0.34, w: 0.84, h: 0.5 }),
  ],
  decoration: [],
  ...over,
})

describe('how far apart two slides are', () => {
  it('is the worst box, not the average of them', () => {
    // One badly misplaced box should keep two slides apart even when every
    // other box lines up perfectly
    const a = slide('a')
    const b: Candidate = {
      ...a,
      slideId: 'b',
      slots: [a.slots[0]!, slot('body', { x: 0.5, y: 0.34, w: 0.84, h: 0.5 })],
    }
    expect(distance(a, b)).toBeCloseTo(0.42, 5)
  })

  it('is infinite when the two are not even made of the same boxes', () => {
    const a = slide('a')
    const b: Candidate = { ...a, slideId: 'b', slots: [a.slots[0]!] }
    expect(distance(b, { ...a, slots: [] })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('slides that were meant to be the same', () => {
  it('become one layout despite the jitter of being built by hand', () => {
    const { layouts } = consolidateCandidates([
      slide('s1', 0),
      slide('s2', 0.004),
      slide('s3', -0.003),
    ])
    expect(layouts).toHaveLength(1)
    expect(layouts[0]!.members).toEqual(['s1', 's2', 's3'])
  })

  it('take the median box, so one slide dragged askew does not move the design', () => {
    const askew = slide('s3', 0.019)
    const { layouts } = consolidateCandidates([slide('s1'), slide('s2'), askew])
    // The median of 0.08, 0.08, 0.099 is 0.08 — the outlier contributes its
    // vote and nothing more
    expect(layouts[0]!.slots[0]!.box.x).toBeCloseTo(0.08, 3)
  })

  it('carry no content into the design, which belongs to the slide', () => {
    const { layouts } = consolidateCandidates([slide('s1'), slide('s2')])
    expect(layouts[0]!.slots.every(s => s.content === undefined)).toBe(true)
  })
})

describe('slides that were not', () => {
  it('stay apart when their boxes differ by more than the tolerance', () => {
    const { layouts } = consolidateCandidates([
      slide('s1'),
      slide('s2'),
      slide('s3', MERGE_TOLERANCE * 3),
      slide('s4', MERGE_TOLERANCE * 3),
    ])
    expect(layouts).toHaveLength(2)
  })

  it('never merge across compositions, however close they look', () => {
    // A title-and-picture slide must not become a title-and-bullets one even
    // when the two boxes land in exactly the same place
    const withImage: Candidate = {
      ...slide('s2'),
      slots: [
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.18 }),
        slot('body', { x: 0.08, y: 0.34, w: 0.84, h: 0.5 }, { kind: 'image' }),
      ],
    }
    const { layouts } = consolidateCandidates([
      slide('s1'),
      slide('s1b'),
      withImage,
      { ...withImage, slideId: 's3' },
    ])
    expect(layouts).toHaveLength(2)
  })

  it('does not chain a run of slides each just under tolerance into one', () => {
    // Single-linkage clustering merges these into one cluster spanning four
    // times the tolerance; average linkage is what stops it
    const drift = [0, 0.018, 0.036, 0.054, 0.072].map((d, i) =>
      slide(`s${i}`, d),
    )
    const { layouts } = consolidateCandidates(drift)
    const spread = (l: (typeof layouts)[number]) =>
      Math.max(...l.members.map(m => drift.findIndex(d => d.slideId === m))) -
      Math.min(...l.members.map(m => drift.findIndex(d => d.slideId === m)))
    expect(Math.max(...layouts.map(spread))).toBeLessThan(4)
  })
})

describe('a design nothing else shares', () => {
  it('does not become a layout of its own', () => {
    // Otherwise a 40-slide deck yields 25 layouts, which is the failure this
    // whole module exists to prevent
    const { layouts } = consolidateCandidates([
      slide('s1'),
      slide('s2'),
      slide('s3'),
      slide('lonely', 0.4),
    ])
    expect(layouts).toHaveLength(1)
  })

  it('is mapped to the nearest layout and reported as approximated', () => {
    const { approximated, assignment } = consolidateCandidates([
      slide('s1'),
      slide('s2'),
      slide('s3'),
      slide('lonely', 0.4),
    ])
    expect(approximated).toEqual([{ slideId: 'lonely', layoutIndex: 0 }])
    // Still assigned, because the slide has to live somewhere (EXP-5)
    expect(assignment.get('lonely')).toBe(0)
  })

  it('does become a layout when the whole deck is one-offs', () => {
    // A two-slide deck has nothing recurring in it; refusing to make layouts
    // would leave it with none at all
    const { layouts, approximated } = consolidateCandidates([
      slide('s1'),
      slide('s2', 0.4),
    ])
    expect(layouts).toHaveLength(2)
    expect(approximated).toHaveLength(0)
  })
})

describe('tidying the whole design at once', () => {
  it('aligns edges that were only nearly aligned, giving the deck a grid', () => {
    const a: Candidate = {
      slideId: 'a1',
      slots: [slot('title', { x: 0.081, y: 0.1, w: 0.8, h: 0.2 })],
      decoration: [],
    }
    const b: Candidate = {
      slideId: 'b1',
      slots: [
        slot('title', { x: 0.081, y: 0.1, w: 0.8, h: 0.2 }),
        slot('body', { x: 0.0794, y: 0.4, w: 0.8, h: 0.3 }),
      ],
      decoration: [],
    }
    const { layouts } = consolidateCandidates([
      a,
      { ...a, slideId: 'a2' },
      b,
      { ...b, slideId: 'b2' },
    ])
    const lefts = layouts.flatMap(l => l.slots.map(s => s.box.x))
    expect(new Set(lefts.map(x => x.toFixed(4))).size).toBe(1)
  })

  it('quantizes the type scale, so a deck has sizes rather than a continuum', () => {
    const sized = (id: string, size: number): Candidate => ({
      slideId: id,
      slots: [
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.2 }, { fontSize: size }),
      ],
      decoration: [],
    })
    const { layouts } = consolidateCandidates([
      sized('s1', 5),
      sized('s2', 5),
      sized('s3', 5.2),
      sized('s4', 5.2),
    ])
    const sizes = new Set(layouts.map(l => l.slots[0]!.fontSize))
    expect(sizes.size).toBe(1)
  })

  // Two layouts, so the two colours are in different layouts and it is
  // standardization deciding their fate rather than the cluster's mode.
  const twoColoured = (a: string, b: string) => [
    {
      slideId: 's1',
      slots: [
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.2 }, { color: a }),
      ],
      decoration: [],
    },
    {
      slideId: 's2',
      slots: [
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.2 }, { color: a }),
      ],
      decoration: [],
    },
    {
      slideId: 's3',
      slots: [
        slot('title', { x: 0.08, y: 0.6, w: 0.84, h: 0.2 }, { color: b }),
      ],
      decoration: [],
    },
    {
      slideId: 's4',
      slots: [
        slot('title', { x: 0.08, y: 0.6, w: 0.84, h: 0.2 }, { color: b }),
      ],
      decoration: [],
    },
  ]

  it('collapses colours that only a machine can tell apart', () => {
    const { layouts } = consolidateCandidates(twoColoured('#1c1917', '#1c1918'))
    expect(layouts).toHaveLength(2)
    expect(new Set(layouts.map(l => l.slots[0]!.color)).size).toBe(1)
  })

  it('keeps colours apart when they are genuinely different', () => {
    const { layouts } = consolidateCandidates(twoColoured('#1c1917', '#c81e1e'))
    expect(new Set(layouts.map(l => l.slots[0]!.color)).size).toBe(2)
  })

  it('gives a merged design its cluster’s most common colour, not the first slide’s', () => {
    const coloured = (id: string, color: string): Candidate => ({
      slideId: id,
      slots: [slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.2 }, { color })],
      decoration: [],
    })
    const { layouts } = consolidateCandidates([
      coloured('s1', '#c81e1e'),
      coloured('s2', '#1c1917'),
      coloured('s3', '#1c1917'),
    ])
    expect(layouts[0]!.slots[0]!.color).toBe('#1c1917')
  })
})

describe('a design that only its background sets apart', () => {
  it('stays a design of its own', () => {
    // A section divider is often the same boxes on a dark band; geometry alone
    // cannot tell it from the content slide it sits between
    const onBackground = (id: string, background: string): Candidate => ({
      slideId: id,
      slots: [slot('title', { x: 0.08, y: 0.4, w: 0.84, h: 0.2 })],
      decoration: [],
      background,
    })
    const { layouts } = consolidateCandidates([
      onBackground('s1', '#ffffff'),
      onBackground('s2', '#ffffff'),
      onBackground('s3', '#101828'),
      onBackground('s4', '#101828'),
    ])
    expect(layouts).toHaveLength(2)
    expect(layouts.map(l => l.background).sort()).toEqual([
      '#101828',
      '#ffffff',
    ])
  })

  it('puts a recurring box in exactly one place across every layout', () => {
    // The most visible cue that a deck was templated rather than hand-built
    const withTitle = (
      id: string,
      y: number,
      extra?: CandidateSlot,
    ): Candidate => ({
      slideId: id,
      slots: [
        slot('title', { x: 0.08, y, w: 0.84, h: 0.18 }),
        ...(extra ? [extra] : []),
      ],
      decoration: [],
    })
    const { layouts } = consolidateCandidates([
      withTitle('a1', 0.1),
      withTitle('a2', 0.1),
      withTitle(
        'b1',
        0.108,
        slot('body', { x: 0.08, y: 0.4, w: 0.84, h: 0.4 }),
      ),
      withTitle(
        'b2',
        0.108,
        slot('body', { x: 0.08, y: 0.4, w: 0.84, h: 0.4 }),
      ),
    ])
    const titles = layouts.map(
      l => l.slots.find(s => s.name === 'title')!.box.y,
    )
    expect(new Set(titles.map(y => y.toFixed(5))).size).toBe(1)
  })

  it('leaves a box where it is when it moves too far to be one place', () => {
    // A title at the top on one layout and centred on another is a design
    // decision, not jitter
    const withTitle = (
      id: string,
      y: number,
      extra?: CandidateSlot,
    ): Candidate => ({
      slideId: id,
      slots: [
        slot('title', { x: 0.08, y, w: 0.84, h: 0.18 }),
        ...(extra ? [extra] : []),
      ],
      decoration: [],
    })
    const { layouts } = consolidateCandidates([
      withTitle('a1', 0.1),
      withTitle('a2', 0.1),
      withTitle('b1', 0.45, slot('body', { x: 0.08, y: 0.7, w: 0.84, h: 0.2 })),
      withTitle('b2', 0.45, slot('body', { x: 0.08, y: 0.7, w: 0.84, h: 0.2 })),
    ])
    const titles = layouts.map(
      l => l.slots.find(s => s.name === 'title')!.box.y,
    )
    expect(Math.max(...titles) - Math.min(...titles)).toBeGreaterThan(
      SNAP_TOLERANCE * 2,
    )
  })

  it('never collapses a box to nothing while aligning it', () => {
    const thin: Candidate = {
      slideId: 't1',
      slots: [slot('rule', { x: 0.08, y: 0.3, w: 0.005, h: 0.4 })],
      decoration: [],
    }
    const { layouts } = consolidateCandidates([
      thin,
      { ...thin, slideId: 't2' },
    ])
    expect(layouts[0]!.slots[0]!.box.w).toBeGreaterThan(0)
  })
})

describe('what the caller gets back', () => {
  it('tells every slide which layout it ended on', () => {
    const { assignment } = consolidateCandidates([
      slide('s1'),
      slide('s2'),
      slide('s3', 0.4),
      slide('s4', 0.4),
    ])
    expect(assignment.get('s1')).toBe(assignment.get('s2'))
    expect(assignment.get('s3')).toBe(assignment.get('s4'))
    expect(assignment.get('s1')).not.toBe(assignment.get('s3'))
  })

  it('assigns every slide it was given, with none left out', () => {
    const slides = ['s1', 's2', 's3', 's4', 'odd'].map((id, i) =>
      slide(id, i === 4 ? 0.4 : 0),
    )
    const { assignment } = consolidateCandidates(slides)
    expect(assignment.size).toBe(5)
  })

  it('handles a deck with no slides at all', () => {
    const { layouts, approximated, assignment } = consolidateCandidates([])
    expect(layouts).toEqual([])
    expect(approximated).toEqual([])
    expect(assignment.size).toBe(0)
  })
})

describe('a picture that repeats on every slide of a design', () => {
  /** Two slides sharing a design, each with a picture in the same corner. */
  const withPicture = (urls: [string, string]): Candidate[] =>
    urls.map((url, i) => ({
      slideId: `s${i + 1}`,
      slots: [
        slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.18 }),
        slot(
          'image',
          { x: 0.86, y: 0.87, w: 0.08, h: 0.07 },
          {
            kind: 'image',
            content: {
              id: `e${i}`,
              kind: 'image',
              box: { x: 0.86, y: 0.87, w: 0.08, h: 0.07 },
              imageUrl: url,
            },
          },
        ),
      ],
      decoration: [],
    }))

  it('is decoration, not a box anyone is asked to fill', () => {
    // A logo belongs to the design; offering it as a slot would ask the author
    // to supply their own logo on every slide, and invite the AI to write into
    // it
    const { layouts } = consolidateCandidates(
      withPicture(['https://x/logo.png', 'https://x/logo.png']),
    )
    expect(layouts[0]!.slots.map(s => s.name)).toEqual(['title'])
    expect(layouts[0]!.decoration).toEqual([
      {
        box: { x: 0.86, y: 0.87, w: 0.08, h: 0.07 },
        imageUrl: 'https://x/logo.png',
      },
    ])
  })

  it('stays content when it differs from slide to slide', () => {
    // A figure is exactly the box an author should fill
    const { layouts } = consolidateCandidates(
      withPicture(['https://x/one.png', 'https://x/two.png']),
    )
    expect(layouts[0]!.slots.map(s => s.name)).toEqual(['title', 'image'])
    expect(layouts[0]!.decoration).toEqual([])
  })

  it('stays content when only one slide has it, which proves nothing', () => {
    const [only] = withPicture(['https://x/logo.png', 'https://x/logo.png'])
    const { layouts } = consolidateCandidates([only!])
    expect(layouts[0]!.slots.map(s => s.name)).toEqual(['title', 'image'])
  })
})
