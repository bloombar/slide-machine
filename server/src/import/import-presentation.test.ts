/**
 * Unit tests for one import, end to end (TMPL-8).
 *
 * The stages have their own tests; what is tested here is the thing none of
 * them can show on its own — that an instructor who waited for an import gets
 * something they can work with, however badly the parts behave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { layoutSchema } from '../templates/builtin'
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
  it('becomes far fewer layouts than it had slides', () => {
    // The whole point: twelve hand-built copies of one design are one design
    const deck = presentation(
      Array.from({ length: 12 }, (_, i) => slide(`s${i}`, (i % 3) * 0.002)),
    )
    return importSourcePresentation(deck).then(({ template, report }) => {
      // One design, plus the blank slate every template owes (TMPL-7)
      expect(template.layouts.map(l => l.type)).toEqual(['list', 'whiteboard'])
      expect(report.slidesRead).toBe(12)
      expect(report.layoutsCreated).toBe(1)
      expect(report.largestMerge).toEqual({ type: 'list', slides: 12 })
    })
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

  it('infers as usual for a presentation carrying no declarations', async () => {
    // A deck from anywhere else has none, and that direction stays lossy
    const { template } = await importSourcePresentation(
      presentation([slide('s1'), slide('s2')]),
    )
    expect(template.layouts[0]!.slots.every(s => s.kind !== 'code')).toBe(true)
  })
})

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
          elements: [
            placeholder('l1-t', 'TITLE', { x: 0.08, y: 0.2, w: 0.84, h: 0.18 }),
          ],
        },
        {
          id: 'l2',
          name: 'SECTION',
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
    expect(template.layouts.filter(l => l.type !== 'whiteboard')).toHaveLength(
      2,
    )
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

  it('are measured from the deck, not guessed from the boxes', async () => {
    // What an author DID is better evidence than what a box could have fitted
    const { template } = await importSourcePresentation(listDeck())
    expect(template.layouts[0]!.constraints).toMatchObject({
      maxBullets: 3,
      maxTitleChars: 24,
    })
  })

  it('take the largest observed, so no slide is over its own limit', async () => {
    const { template } = await importSourcePresentation(listDeck())
    const { maxTitleChars } = template.layouts[0]!.constraints!
    expect(maxTitleChars).toBe('A much longer title here'.length)
  })

  it('say nothing about a box the design does not have', async () => {
    const { template } = await importSourcePresentation(listDeck())
    expect(template.layouts[0]!.constraints).not.toHaveProperty(
      'maxCaptionChars',
    )
    expect(template.layouts[0]!.constraints).not.toHaveProperty('imageRequired')
  })

  it('reach the layout the AI selects from', async () => {
    const { template } = await importSourcePresentation(listDeck())
    expect(layoutSchema.safeParse(template.layouts[0]).success).toBe(true)
  })
})
