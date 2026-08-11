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
  /** A deck whose slides sit on layouts its author actually made. */
  const authored = (): SourcePresentation => {
    const on = (id: string, layoutId: string, y: number): SourcePage => ({
      id,
      layoutId,
      elements: [
        element({
          id: `${id}-t`,
          placeholder: 'TITLE',
          box: { x: 0.08, y, w: 0.84, h: 0.18 },
        }),
      ],
    })
    return {
      ...presentation([
        on('s1', 'l1', 0.1),
        on('s2', 'l1', 0.1),
        on('s3', 'l2', 0.45),
        on('s4', 'l2', 0.45),
      ]),
      layouts: [
        { id: 'l1', name: 'TITLE_AND_BODY', elements: [] },
        { id: 'l2', name: 'SECTION', elements: [] },
      ],
    }
  }

  it('uses the author’s grouping rather than clustering over it', async () => {
    // The author already did the work consolidation exists to do
    const { template } = await importSourcePresentation(authored())
    expect(template.layouts.filter(l => l.type !== 'whiteboard')).toHaveLength(
      2,
    )
  })

  it('approximates nothing, since every slide sat on a chosen layout', async () => {
    const { report } = await importSourcePresentation(authored())
    expect(report.approximated).toBe(0)
    expect(report.layoutsCreated).toBe(2)
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

  it('falls back to clustering when a group’s slides do not agree', async () => {
    // Slides Google says share a layout but that hold different boxes are not
    // one design in any usable sense
    const mixed = authored()
    mixed.slides[1]!.elements.push(
      element({ id: 'extra', box: { x: 0.1, y: 0.6, w: 0.3, h: 0.2 } }),
    )
    const { template } = await importSourcePresentation(mixed)
    expect(template.layouts.length).toBeGreaterThan(0)
    for (const layout of template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })
})
