/**
 * Unit tests for one import, end to end (TMPL-8).
 *
 * The stages have their own tests; what is tested here is the thing none of
 * them can show on its own — that an instructor who waited for an import gets
 * something they can work with, however badly the parts behave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { layoutSchema } from '../templates/builtin'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import type { LayoutDecoration } from '@slide-machine/shared'
import { candidateOf } from './candidate'
import { toSourcePresentation } from './read-slides'
import { observedFrom } from './consolidate'
import { importSourcePresentation, assetPrefix } from './import-presentation'
import type {
  SourceElement,
  SourcePage,
  SourcePresentation,
} from './source-presentation'

const put = vi.fn()
vi.mock('../storage', () => ({
  getStorage: () => ({
    put,
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  }),
}))

const element = (over: Partial<SourceElement> = {}): SourceElement => ({
  id: 'e1',
  kind: 'text',
  box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
  runs: [{ text: 'Hello', fontSize: 5 }],
  ...over,
})

/** A title-and-bullets slide, nudged the way a hand nudges one. */
const slide = (id: string, jitter = 0): SourcePage => ({
  id,
  elements: [
    element({
      id: `${id}-t`,
      box: { x: 0.08 + jitter, y: 0.1, w: 0.84, h: 0.18 },
      placeholder: 'TITLE',
    }),
    element({
      id: `${id}-b`,
      box: { x: 0.08 + jitter, y: 0.34, w: 0.84, h: 0.5 },
      placeholder: 'BODY',
      bulleted: true,
      runs: [{ text: 'A point', fontSize: 2.5 }],
    }),
  ],
})

const presentation = (slides: SourcePage[]): SourcePresentation => ({
  id: 'p1',
  title: 'Rainwater',
  theme: {
    background: '#ffffff',
    text: '#1c2230',
    accent: '#0066ff',
    muted: '#667085',
  },
  layouts: [],
  slides,
})

beforeEach(() => {
  put.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('a hand-built deck', () => {
  it('becomes far fewer layouts than it had slides', async () => {
    // The whole point: twelve hand-built copies of one design are one design
    const deck = presentation(
      Array.from({ length: 12 }, (_, i) => slide(`s${i}`, (i % 3) * 0.002)),
    )
    const { template, report } = await importSourcePresentation(deck)
    // One design, plus the blank slate every template owes (TMPL-7)
    expect(template.layouts.map(l => l.type)).toEqual(['list', 'whiteboard'])
    expect(report.slidesRead).toBe(12)
    expect(report.layoutsCreated).toBe(1)
    expect(report.largestMerge).toEqual({ type: 'list', slides: 12 })
  })

  it('tidies the copies onto one grid, which is the point of deriving', async () => {
    // Twelve hands missing the same spot is one intention, not twelve
    const deck = presentation([
      slide('s0', 0),
      slide('s1', 0.002),
      slide('s2', 0.004),
    ])
    const { template } = await importSourcePresentation(deck)
    const xs = template.layouts
      .filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
      .map(l => l.elementPositions!.title!.x)
    expect(new Set(xs).size).toBe(1)
  })

  it('keeps every slide when the author asks for that instead', async () => {
    // The judgement is offered rather than assumed: a short deck of genuinely
    // different pages wants them all back (TMPL-8)
    const deck = presentation(
      Array.from({ length: 12 }, (_, i) => slide(`s${i}`, (i % 3) * 0.002)),
    )
    const { template, report } = await importSourcePresentation(deck, {
      keepEverySlide: true,
    })
    expect(template.layouts).toHaveLength(13)
    expect(template.layouts.at(-1)!.type).toBe(WHITEBOARD_LAYOUT_TYPE)
    expect(report.layoutsCreated).toBe(12)
  })

  it('keeps each copy’s own position when every slide is kept', async () => {
    // No clustering means no snapping: the jitter IS the deck
    const deck = presentation([
      slide('s0', 0),
      slide('s1', 0.002),
      slide('s2', 0.004),
    ])
    const { template } = await importSourcePresentation(deck, {
      keepEverySlide: true,
    })
    const xs = template.layouts
      .filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
      .map(l => l.elementPositions!.title!.x)
    expect(new Set(xs).size).toBe(3)
  })

  it('approximates nothing when every slide is kept', async () => {
    const deck = presentation(
      Array.from({ length: 5 }, (_, i) => slide(`s${i}`, i * 0.003)),
    )
    const { report } = await importSourcePresentation(deck, {
      keepEverySlide: true,
    })
    expect(report.approximated).toBe(0)
    expect(report.largestMerge).toBeUndefined()
  })

  it('produces layouts the template schema accepts', async () => {
    const { template } = await importSourcePresentation(
      presentation([slide('s1'), slide('s2')]),
    )
    for (const layout of template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })

  it('tells the lecture importer where every slide ended up', async () => {
    const { template } = await importSourcePresentation(
      presentation([slide('s1'), slide('s2')]),
    )
    expect(Object.keys(template.layoutOfSlide).sort()).toEqual(['s1', 's2'])
  })
})

describe('when the model will not cooperate', () => {
  const deck = () => presentation([slide('s1'), slide('s2')])

  it('names the layouts by rule when the call throws', async () => {
    // An import must not depend on a model being reachable
    const { template } = await importSourcePresentation(deck(), {
      provider: {
        describeImportedLayouts: async () => {
          throw new Error('provider down')
        },
      },
    })
    expect(template.layouts[0]!.type).toBe('list')
  })

  it('names them by rule when the answer is nonsense', async () => {
    const { template } = await importSourcePresentation(deck(), {
      provider: {
        describeImportedLayouts: async () =>
          [{ type: 42, slots: 'no' }] as never,
      },
    })
    expect(template.layouts[0]!.type).toBe('list')
  })

  it('uses what the model said when it says something usable', async () => {
    const { template } = await importSourcePresentation(deck(), {
      provider: {
        describeImportedLayouts: async () => [
          {
            type: 'lesson-opener',
            description: 'A heading with the points under it.',
            slots: { title: 'The point of the slide.' },
          },
        ],
      },
    })
    expect(template.layouts[0]!.type).toBe('lesson-opener')
    expect(template.layouts[0]!.purpose).toBe(
      'A heading with the points under it.',
    )
    expect(template.layouts[0]!.slots[0]!.description).toBe(
      'The point of the slide.',
    )
  })

  it('never lets the model move a box', async () => {
    const plain = await importSourcePresentation(deck())
    const meddled = await importSourcePresentation(deck(), {
      provider: {
        describeImportedLayouts: async () =>
          [
            {
              type: 'title-and-bullets',
              elementPositions: { title: { x: 0.9 } },
            },
          ] as never,
      },
    })
    expect(meddled.template.layouts[0]!.elementPositions).toEqual(
      plain.template.layouts[0]!.elementPositions,
    )
  })
})

describe('when a picture will not come', () => {
  const withImage = (): SourcePresentation => {
    const deck = presentation([slide('s1'), slide('s2')])
    for (const page of deck.slides) {
      page.elements.push(
        element({
          id: `${page.id}-i`,
          kind: 'image',
          imageUrl: 'https://x/logo.png',
          box: { x: 0.7, y: 0.8, w: 0.2, h: 0.15 },
        }),
      )
    }
    return deck
  }

  it('counts it and imports the rest', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    const { template, report } = await importSourcePresentation(withImage(), {
      assetPrefix: 'templates/import/u1/p1',
    })
    expect(report.assetsFailed).toBe(1)
    expect(template.layouts.length).toBeGreaterThan(0)
  })

  it('fetches a repeated picture once, not once per slide', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: {
        get: (n: string) => (n === 'content-type' ? 'image/png' : null),
      },
      arrayBuffer: async () => Buffer.from([1, 2, 3]).buffer,
    } as unknown as Response)
    await importSourcePresentation(withImage(), {
      assetPrefix: 'templates/import/u1/p1',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not touch the network when no prefix was given', async () => {
    // Deriving a design is useful on its own; fetching files is not always
    // wanted
    await importSourcePresentation(withImage())
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('a presentation with nothing in it', () => {
  it('still yields a template rather than an error', async () => {
    const { template, report } = await importSourcePresentation(
      presentation([]),
    )
    expect(template.layouts.map(l => l.type)).toEqual(['whiteboard'])
    expect(report).toMatchObject({ slidesRead: 0, layoutsCreated: 0 })
  })
})

describe('where a template’s files live', () => {
  it('is keyed by owner and presentation, so two imports never collide', () => {
    expect(assetPrefix('u1', 'p1')).toBe('templates/import/u1/p1')
    expect(assetPrefix('u1', 'p2')).not.toBe(assetPrefix('u1', 'p1'))
    expect(assetPrefix('u2', 'p1')).not.toBe(assetPrefix('u1', 'p1'))
  })
})

describe('a presentation this system exported (EXP-8)', () => {
  /** A deck carrying the slot declarations our own export writes. */
  const roundTrip = (): SourcePresentation => {
    const declared = [
      {
        name: 'title',
        kind: 'text',
        label: 'Slide title',
        maxChars: 60,
        required: true,
      },
      {
        name: 'worked-example',
        kind: 'code',
        label: 'Worked example',
        description: 'A runnable Python snippet, no more than eight lines.',
        options: { language: 'python' },
      },
    ]
    const tagged = (id: string): SourcePage => ({
      id,
      layoutId: 'l1',
      elements: [
        element({
          id: `${id}-t`,
          slotName: 'title',
          box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
        }),
        element({
          id: `${id}-c`,
          slotName: 'worked-example',
          box: { x: 0.08, y: 0.34, w: 0.84, h: 0.5 },
          // On the slide it is just text: nothing about the shape says code
          runs: [{ text: 'print(1)', fontSize: 2.5 }],
        }),
      ],
    })
    return {
      ...presentation([tagged('s1'), tagged('s2')]),
      layouts: [
        {
          id: 'l1',
          name: 'CONTENT',
          elements: [],
          slotMetadata: declared as unknown as Record<string, unknown>[],
        },
      ],
    }
  }

  it('restores a box’s kind, which geometry could never recover', async () => {
    // A code box holding a listing is indistinguishable from prose on the
    // slide; being told is the only way to know
    const { template } = await importSourcePresentation(roundTrip())
    const slot = template.layouts[0]!.slots.find(
      s => s.name === 'worked-example',
    )
    expect(slot!.kind).toBe('code')
  })

  it('restores the author’s instruction and limits exactly', async () => {
    const { template } = await importSourcePresentation(roundTrip())
    const slots = template.layouts[0]!.slots
    expect(slots.find(s => s.name === 'worked-example')).toMatchObject({
      label: 'Worked example',
      description: 'A runnable Python snippet, no more than eight lines.',
      options: { language: 'python' },
    })
    expect(slots.find(s => s.name === 'title')).toMatchObject({
      maxChars: 60,
      required: true,
    })
  })

  it('still produces layouts the template schema accepts', async () => {
    const { template } = await importSourcePresentation(roundTrip())
    for (const layout of template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })

  it('round-trips whatever the author ticked, because the spec has no condition on it', async () => {
    // "Keep every slide" is a judgement about a deck from elsewhere. Our own
    // export already states its grouping, and TMPL-8/EXP-6 promise that
    // grouping back unconditionally — two slides built on one layout are one
    // layout, not two, however the box is set
    const { template, report } = await importSourcePresentation(roundTrip(), {
      keepEverySlide: true,
    })
    const designed = template.layouts.filter(
      l => l.type !== WHITEBOARD_LAYOUT_TYPE,
    )
    expect(designed).toHaveLength(1)
    expect(report.layoutsCreated).toBe(1)
  })

  it('restores declared kinds on a round trip even with every slide kept', async () => {
    // The other half of lossless: the grouping survives above, the metadata
    // has to survive with it
    const { template } = await importSourcePresentation(roundTrip(), {
      keepEverySlide: true,
    })
    const slot = template.layouts[0]!.slots.find(
      s => s.name === 'worked-example',
    )
    expect(slot!.kind).toBe('code')
    expect(slot!.options).toEqual({ language: 'python' })
  })

  it('infers as usual for a presentation carrying no declarations', async () => {
    // A deck from anywhere else has none, and that direction stays lossy
    const { template } = await importSourcePresentation(
      presentation([slide('s1'), slide('s2')]),
    )
    expect(template.layouts[0]!.slots.every(s => s.kind !== 'code')).toBe(true)
  })
})

/**
 * Re-importing a presentation THIS system exported (EXP-8).
 *
 * An export carries its own slot declarations, so a round trip has to give
 * back the template it came from — the same layouts, with the slides that wore
 * each one grouped under it. A deck from anywhere else has no such record, and
 * the designs it is built from are worked out by clustering instead.
 */
describe('a presentation that defines its own layouts', () => {
  /** A placeholder on a layout page: a real box, and no words — which is what
   * a layout page IS. */
  const placeholder = (
    id: string,
    type: string,
    box: { x: number; y: number; w: number; h: number },
  ): SourceElement => ({ id, kind: 'text', box, placeholder: type, runs: [] })

  /**
   * A deck whose slides sit on layouts its author made. The layout pages put
   * the title at y=0.2; every slide that uses them has nudged it to y=0.1, so
   * the two sources disagree and it is visible which one was believed.
   */
  const authored = (): SourcePresentation => {
    const on = (id: string, layoutId: string): SourcePage => ({
      id,
      layoutId,
      elements: [
        element({
          id: `${id}-t`,
          placeholder: 'TITLE',
          box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
          runs: [{ text: 'Nine chars', fontSize: 5 }],
        }),
      ],
    })
    return {
      ...presentation([
        on('s1', 'l1'),
        on('s2', 'l1'),
        on('s3', 'l2'),
        on('s4', 'l2'),
      ]),
      layouts: [
        {
          id: 'l1',
          name: 'TITLE_AND_BODY',
          // What this system writes onto its own exports (EXP-8), and what
          // marks the deck as a round trip rather than an unknown one.
          slotMetadata: [{ name: 'title', kind: 'text', label: 'Title' }],
          elements: [
            placeholder('l1-t', 'TITLE', { x: 0.08, y: 0.2, w: 0.84, h: 0.18 }),
          ],
        },
        {
          id: 'l2',
          name: 'SECTION',
          slotMetadata: [{ name: 'title', kind: 'text', label: 'Title' }],
          elements: [
            placeholder('l2-t', 'TITLE', { x: 0.08, y: 0.5, w: 0.84, h: 0.18 }),
          ],
        },
      ],
    }
  }

  it('takes its boxes from the layout, not from the slides wearing it', async () => {
    // The layout IS the design; a slide is one use of it, and a hand that
    // nudged a box on every slide has not redesigned the layout
    const { template } = await importSourcePresentation(authored())
    expect(template.layouts[0]!.elementPositions.title!.y).toBeCloseTo(0.2, 3)
  })

  it('takes styling from the slides, which is where a layout page is silent', async () => {
    // A layout page's placeholders are empty, so they state no type size
    const { template } = await importSourcePresentation(authored())
    expect(template.layouts[0]!.elementPositions.title!.fontSize).toBe(5)
  })

  it('uses the author’s grouping rather than clustering over it', async () => {
    const { template } = await importSourcePresentation(authored())
    expect(template.layouts.filter(l => l.type !== 'whiteboard')).toHaveLength(
      2,
    )
  })

  it('counts the slides built on each layout, not the layout pages', async () => {
    const { report, template } = await importSourcePresentation(authored())
    expect(report.approximated).toBe(0)
    expect(report.layoutsCreated).toBe(2)
    // Both layouts carry two slides, so the first wins the tie — and the one
    // whose heading sits near the top is a title slide, the lower one a
    // section marker
    expect(report.largestMerge).toEqual({ type: 'title', slides: 2 })
    expect(
      template.layouts.map(l => l.type).filter(t => t !== 'whiteboard'),
    ).toEqual(['title', 'section'])
  })

  it('tells the lecture importer where every slide went', async () => {
    const { template } = await importSourcePresentation(authored())
    expect(Object.keys(template.layoutOfSlide).sort()).toEqual([
      's1',
      's2',
      's3',
      's4',
    ])
  })

  it('falls back to clustering when a layout page has no boxes to read', async () => {
    // An empty layout page tells us less than the slides do
    const bare = authored()
    bare.layouts = bare.layouts.map(l => ({ ...l, elements: [] }))
    const { template } = await importSourcePresentation(bare)
    expect(template.layouts.length).toBeGreaterThan(1)
    for (const layout of template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })

  it('ignores the default layouts a hand-built deck happens to carry', async () => {
    // Google gives every deck a layouts array; grouping a hand-built one by it
    // would yield a single layout for the whole deck
    const hand = presentation([
      slide('s1'),
      slide('s2'),
      slide('s3', 0.3),
      slide('s4', 0.3),
    ])
    hand.layouts = [
      { id: 'l1', elements: [] },
      { id: 'l2', elements: [] },
    ]
    const { template } = await importSourcePresentation(hand)
    // No slide names a layout, so clustering decides — and finds two designs
    expect(
      template.layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE),
    ).toHaveLength(2)
  })

  it('is skipped when the author asks to keep every slide', async () => {
    // An authored grouping is still a grouping, and keeping every slide means
    // exactly that (TMPL-8). A deck from elsewhere that happens to define
    // layouts is the deck this option is about, so strip what marks a round
    // trip and the grouping gives way
    const foreign = authored()
    foreign.layouts = foreign.layouts.map(({ slotMetadata: _, ...l }) => l)
    const { template } = await importSourcePresentation(foreign, {
      keepEverySlide: true,
    })
    expect(
      template.layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE),
    ).toHaveLength(foreign.slides.length)
  })

  it('is not skipped for our own export, whatever the author ticked', async () => {
    // The round trip is promised without conditions (TMPL-8; EXP-6), so it is
    // not the checkbox's to revoke: four slides on two authored layouts come
    // back as two layouts, not four
    const { template } = await importSourcePresentation(authored(), {
      keepEverySlide: true,
    })
    expect(
      template.layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE),
    ).toHaveLength(2)
  })
})

describe('the ceilings a design was built to (TMPL-6)', () => {
  const listDeck = (): SourcePresentation =>
    presentation([
      {
        id: 's1',
        elements: [
          element({
            id: 's1-t',
            placeholder: 'TITLE',
            box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
            runs: [{ text: 'Nine char', fontSize: 5 }],
          }),
          element({
            id: 's1-b',
            placeholder: 'BODY',
            box: { x: 0.08, y: 0.34, w: 0.84, h: 0.5 },
            bulleted: true,
            runs: [{ text: 'one\ntwo\nthree', fontSize: 2.5 }],
          }),
        ],
      },
      {
        id: 's2',
        elements: [
          element({
            id: 's2-t',
            placeholder: 'TITLE',
            box: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
            runs: [{ text: 'A much longer title here', fontSize: 5 }],
          }),
          element({
            id: 's2-b',
            placeholder: 'BODY',
            box: { x: 0.08, y: 0.34, w: 0.84, h: 0.5 },
            bulleted: true,
            runs: [{ text: 'one\ntwo', fontSize: 2.5 }],
          }),
        ],
      },
    ])

  /** The deck's slides, as consolidation sees them. */
  const asCandidates = () => listDeck().slides.map(page => candidateOf(page))

  it('are measured from the deck, not guessed from the boxes', () => {
    // What an author DID is better evidence than what a box could have fitted
    expect(observedFrom(asCandidates())).toMatchObject({
      maxBullets: 3,
      maxTitleChars: 24,
    })
  })

  it('take the largest observed, so no slide is over its own limit', () => {
    expect(observedFrom(asCandidates())?.maxTitleChars).toBe(
      'A much longer title here'.length,
    )
  })

  it('say nothing about a box the design does not have', () => {
    const constraints = observedFrom(asCandidates())
    expect(constraints).not.toHaveProperty('maxCaptionChars')
    expect(constraints).not.toHaveProperty('imageRequired')
  })

  it('reach the template when the deck is consolidated', async () => {
    // Measured across the slides of a design, which is what makes them a
    // ceiling rather than one slide's word count
    const { template } = await importSourcePresentation(listDeck())
    expect(template.layouts[0]!.constraints).toMatchObject({
      maxTitleChars: 'A much longer title here'.length,
    })
  })

  it('are left off when every slide is kept', async () => {
    // A ceiling read off many slides says what the design holds. Read off one
    // it says only what that slide happened to say — a title of "Nine char"
    // would cap the box at nine characters for good. With none, the limit
    // comes from the box and its type, which is what one slide can tell you.
    const { template } = await importSourcePresentation(listDeck(), {
      keepEverySlide: true,
    })
    for (const layout of template.layouts) {
      expect(layout.constraints).toBeUndefined()
    }
  })

  it('reach the layout the AI selects from', async () => {
    const { template } = await importSourcePresentation(listDeck())
    expect(layoutSchema.safeParse(template.layouts[0]).success).toBe(true)
  })
})

/**
 * A deck whose slides carry nothing but placeholders their author never
 * sized. Google returns those with no size and no transform anywhere in the
 * chain, the reader drops them (a shape with no place on the page cannot be
 * drawn), and what is left is slides with no boxes at all.
 */
describe('a presentation with nothing to derive', () => {
  const emptySlide = (id: string): SourcePage => ({ id, elements: [] })

  const emptyDeck = (): SourcePresentation => ({
    id: 'p1',
    title: 'Untitled presentation',
    theme: {
      background: '#ffffff',
      text: '#1c2230',
      accent: '#0066ff',
      muted: '#667085',
    },
    layouts: [],
    slides: ['s1', 's2', 's3'].map(emptySlide),
  })

  it('still yields a template, rather than failing the import', async () => {
    const { template } = await importSourcePresentation(emptyDeck())
    expect(template.name).toBe('Untitled presentation')
  })

  it('derives no layout from a slide that has no boxes', async () => {
    // A layout must declare at least one box, so an empty one would be a
    // template that cannot be saved — and an empty layout is not a design
    // the author would keep anyway
    const { template } = await importSourcePresentation(emptyDeck())
    const derived = template.layouts.filter(
      l => l.type !== WHITEBOARD_LAYOUT_TYPE,
    )
    expect(derived).toEqual([])
  })

  it('leaves the blank slate every template must offer', async () => {
    const { template } = await importSourcePresentation(emptyDeck())
    expect(template.layouts.map(l => l.type)).toEqual([WHITEBOARD_LAYOUT_TYPE])
  })

  it('every layout it does produce passes the template schema', async () => {
    // The check that would have caught this: a zero-slot layout is rejected
    const { template } = await importSourcePresentation(emptyDeck())
    for (const layout of template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })

  it('reports the slides it read and the nothing it made of them', async () => {
    const { report } = await importSourcePresentation(emptyDeck())
    expect(report.slidesRead).toBe(3)
    expect(report.layoutsCreated).toBe(0)
    expect(report.approximated).toBe(0)
  })
})

/**
 * A deck whose slides are each a different colour (TMPL-8).
 *
 * A template has ONE theme background; a deck like this has as many as it has
 * designs. Consolidation already refuses to make two colours into one layout,
 * but the colour was dropped on the way into the layout — so a red, a blue and
 * an orange slide all arrived red.
 */
describe('a deck of several colours', () => {
  const text = (
    id: string,
    placeholder: string,
    box: { x: number; y: number; w: number; h: number },
  ): SourceElement => ({ id, kind: 'text', box, placeholder })

  const colourDeck = (): SourcePresentation => ({
    id: 'p1',
    title: 'Untitled presentation',
    theme: {
      background: '#e8382a',
      text: '#000000',
      accent: '#4285f4',
      muted: '#595959',
    },
    layouts: [],
    slides: [
      {
        id: 's1',
        background: '#e8382a',
        elements: [
          text('t1', 'CENTERED_TITLE', { x: 0.06, y: 0.12, w: 0.88, h: 0.3 }),
        ],
      },
      // A colour and an arrow, and not one box an author could type into
      {
        id: 's2',
        background: '#5b8ad9',
        elements: [
          {
            id: 'a2',
            kind: 'decoration',
            box: { x: 0.15, y: 0.06, w: 0.7, h: 0.1 },
            fill: '#eeeeee',
          },
        ],
      },
      {
        id: 's3',
        background: '#e8992a',
        elements: [
          text('t3', 'TITLE', { x: 0.06, y: 0.08, w: 0.88, h: 0.14 }),
          text('b3', 'BODY', { x: 0.6, y: 0.45, w: 0.34, h: 0.3 }),
        ],
      },
    ],
  })

  /** The full-bleed fill a layout is painted with, if it has one. */
  const backgroundOf = (layout: { decoration?: LayoutDecoration[] }) =>
    layout.decoration?.find(d => d.w === 1 && d.h === 1)?.fill

  const derivedLayouts = async () => {
    const { template } = await importSourcePresentation(colourDeck())
    return template.layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
  }

  it('gives every slide a layout of its own', async () => {
    // Three designs in, three designs out — not two
    expect(await derivedLayouts()).toHaveLength(3)
  })

  it('paints each layout the colour its slide was', async () => {
    const colours = (await derivedLayouts()).map(backgroundOf)
    expect(colours).toEqual(['#e8382a', '#5b8ad9', '#e8992a'])
  })

  it('paints the colour behind everything else on the layout', async () => {
    // Order is paint order: a band drawn under its own background would be
    // invisible
    const blue = (await derivedLayouts()).find(
      l => backgroundOf(l) === '#5b8ad9',
    )
    expect(blue!.decoration![0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1 })
    expect(blue!.decoration![1]).toMatchObject({ fill: '#eeeeee' })
  })

  it('keeps a slide that is a colour and a shape and nothing else', async () => {
    // Dropping it loses a whole page of the deck
    const blue = (await derivedLayouts()).find(
      l => backgroundOf(l) === '#5b8ad9',
    )
    expect(blue).toBeDefined()
    expect(blue!.decoration).toHaveLength(2)
  })

  it('gives that layout a box, since a layout must declare one', async () => {
    const blue = (await derivedLayouts()).find(
      l => backgroundOf(l) === '#5b8ad9',
    )
    expect(blue!.slots.map(s => s.name)).toEqual(['body'])
    expect(blue!.elementPositions!.body).toMatchObject({ w: 0.84 })
  })

  it('produces layouts the template schema accepts', async () => {
    for (const layout of await derivedLayouts()) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })
})

/**
 * A list, all the way from what Google actually returns.
 *
 * Every other test here starts from a `SourcePresentation` — already parsed —
 * so none of them could see the seam where this broke: the reader dropped the
 * newlines that end Slides' paragraphs, and a four-point list arrived as the
 * single run "OneTwoThreeFour". Downstream everything then behaved correctly
 * on input that was already wrong: one bullet, and a design whose ceiling said
 * its lists hold one line (TMPL-6).
 *
 * This starts from the raw response, so the seam is covered.
 */
describe('a bulleted list, read the way Google sends it', () => {
  const EMU = { w: 9144000, h: 5143500 }
  const emu = (m: number) => ({ magnitude: m, unit: 'EMU' })

  const textBox = (
    id: string,
    at: { x: number; y: number; w: number; h: number },
    elements: unknown[],
  ) => ({
    objectId: id,
    size: { width: emu(at.w * EMU.w), height: emu(at.h * EMU.h) },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: emu(at.x * EMU.w),
      translateY: emu(at.y * EMU.h),
    },
    shape: { shapeType: 'TEXT_BOX', text: { textElements: elements } },
  })

  /** One paragraph, ended by the newline Slides ends them with. */
  const paragraph = (text: string, bulleted = false) => [
    { paragraphMarker: bulleted ? { bullet: {} } : {} },
    { textRun: { content: `${text}\n`, style: {} } },
  ]

  const listSlide = (id: string, title: string, points: string[]) => ({
    objectId: id,
    pageElements: [
      textBox(
        `${id}-t`,
        { x: 0.08, y: 0.1, w: 0.84, h: 0.15 },
        paragraph(title),
      ),
      textBox(
        `${id}-b`,
        { x: 0.08, y: 0.3, w: 0.84, h: 0.5 },
        points.flatMap(point => paragraph(point, true)),
      ),
    ],
  })

  const read = () =>
    toSourcePresentation({
      presentationId: 'p1',
      title: 'Bullets',
      pageSize: { width: emu(EMU.w), height: emu(EMU.h) },
      masters: [],
      layouts: [],
      slides: [
        listSlide('s0', 'Key points', ['One', 'Two', 'Three', 'Four']),
        listSlide('s1', 'More points', ['Alpha', 'Beta', 'Gamma', 'Delta']),
      ],
    } as never)

  it('comes back as the points it went in as', async () => {
    const { slides } = await importSourcePresentation(read())
    expect(slides?.[0]?.slots.body).toEqual({
      kind: 'bullets',
      items: ['One', 'Two', 'Three', 'Four'],
    })
  })

  it('leaves the title as its own text, not the first point', async () => {
    const { slides } = await importSourcePresentation(read())
    expect(slides?.[0]?.slots.title).toEqual({
      kind: 'text',
      value: 'Key points',
    })
  })

  it('derives a design whose lists hold what the deck put in them', async () => {
    const { template } = await importSourcePresentation(read())
    const list = template.layouts.find(l => l.constraints?.maxBullets)
    expect(list?.constraints?.maxBullets).toBe(4)
  })
})
