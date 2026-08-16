/**
 * Unit tests for turning a consolidated deck into a template (TMPL-8, stage 3).
 *
 * The bar is that the template schema accepts what comes out — an import that
 * produces something the editor cannot open has failed however good the
 * geometry was — so the real assertion here is that `layoutSchema` parses it.
 */
import { describe, it, expect } from 'vitest'
import { layoutSchema } from '../templates/builtin'
import type { CandidateSlot } from './candidate'
import type { DerivedLayout } from './consolidate'
import { buildTemplate, importReport, mapFont } from './build-template'
import type { SourcePresentation } from './source-presentation'

const slot = (
  name: string,
  box: { x: number; y: number; w: number; h: number },
  over: Partial<CandidateSlot> = {},
): CandidateSlot => ({ name, kind: 'text', box, ...over })

const derived = (over: Partial<DerivedLayout> = {}): DerivedLayout => ({
  slots: [
    slot('title', { x: 0.08, y: 0.1, w: 0.84, h: 0.18 }, { fontSize: 5 }),
    slot('body', { x: 0.08, y: 0.34, w: 0.84, h: 0.5 }, { kind: 'bullets' }),
  ],
  decoration: [],
  members: ['s1', 's2'],
  type: 'list',
  ...over,
})

const source = (
  over: Partial<SourcePresentation> = {},
): SourcePresentation => ({
  id: 'p1',
  title: 'Rainwater',
  theme: {
    background: '#ffffff',
    text: '#1c2230',
    accent: '#0066ff',
    muted: '#667085',
  },
  layouts: [],
  slides: [],
  ...over,
})

describe('the template that comes out', () => {
  it('is one the template schema accepts', () => {
    // An import that produces something the editor cannot open has failed
    const { layouts } = buildTemplate(source(), [derived()], new Map())
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })

  it('places each box where the presentation had it', () => {
    const { layouts } = buildTemplate(source(), [derived()], new Map())
    expect(layouts[0]!.elementPositions.title).toMatchObject({
      x: 0.08,
      y: 0.1,
      w: 0.84,
      h: 0.18,
    })
  })

  it('keeps the type size and colour the slide was drawn in', () => {
    // Which is the point of importing a design rather than describing one
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          slots: [
            slot(
              'title',
              { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
              { fontSize: 6.2, bold: true, color: '#b45309' },
            ),
          ],
        }),
      ],
      new Map(),
    )
    expect(layouts[0]!.elementPositions.title).toMatchObject({
      fontSize: 6.2,
      fontWeight: 700,
      color: '#b45309',
    })
  })

  it('takes its colours from the presentation', () => {
    const { theme } = buildTemplate(source(), [derived()], new Map())
    expect(theme).toMatchObject({
      background: '#ffffff',
      text: '#1c2230',
      accent: '#0066ff',
    })
  })

  it('is drawn as positioned, since an imported design has no tree', () => {
    const built = buildTemplate(source(), [derived()], new Map())
    expect(built.renderMode).toBe('positioned')
    expect(built.layouts[0]!.tree).toBeUndefined()
  })

  it('names each layout what the model called it', () => {
    const { layouts } = buildTemplate(source(), [derived()], new Map())
    expect(layouts[0]!.type).toBe('list')
    expect(layouts[0]!.label).toBe('List')
  })

  it('falls back to the rules when nothing named a layout', () => {
    const { layouts } = buildTemplate(
      source(),
      [derived({ type: undefined })],
      new Map(),
    )
    expect(layouts[0]!.type).toBe('list')
  })

  it('keeps two layouts apart when they were given the same name', () => {
    // A duplicate type would make one of the two unreachable
    const { layouts } = buildTemplate(
      source(),
      [derived(), derived({ members: ['s3', 's4'] })],
      new Map(),
    )
    expect(layouts[0]!.type).not.toBe(layouts[1]!.type)
    expect(layouts.every(l => layoutSchema.safeParse(l).success)).toBe(true)
  })

  it('shapes a type name into the slug the rest of the system keys on', () => {
    const { layouts } = buildTemplate(
      source(),
      [derived({ type: 'Two Column!!' })],
      new Map(),
    )
    expect(layouts[0]!.type).toBe('two-column')
  })

  it('carries a slot description through, capped', () => {
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          slots: [
            slot(
              'title',
              { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
              { description: 'x'.repeat(500) },
            ),
          ],
        }),
      ],
      new Map(),
    )
    expect(layouts[0]!.slots[0]!.description!.length).toBe(200)
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })

  it('tells the lecture importer which layout each slide ended on', () => {
    const built = buildTemplate(
      source(),
      [derived(), derived({ type: 'section', members: ['s3'] })],
      new Map([
        ['s1', 0],
        ['s2', 0],
        ['s3', 1],
      ]),
    )
    expect(built.layoutOfSlide).toEqual({
      s1: 'list',
      s2: 'list',
      s3: 'section',
    })
  })
})

describe('a presentation that does not cooperate', () => {
  it('still yields a template when it has no usable slides', () => {
    // Failing an import because a deck was unusual helps nobody. It is not
    // empty: every template owes a blank slate (TMPL-7).
    const built = buildTemplate(source(), [], new Map())
    expect(built.layouts.map(l => l.type)).toEqual(['whiteboard'])
    expect(built.name).toBe('Rainwater')
  })

  it('gives an untitled presentation a name anyway', () => {
    const built = buildTemplate(source({ title: '' }), [], new Map())
    expect(built.name).toBe('Imported design')
  })

  it('pulls a box back onto the slide when it hung off the edge', () => {
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          slots: [slot('title', { x: 0.95, y: 0.95, w: 0.5, h: 0.5 })],
        }),
      ],
      new Map(),
    )
    const box = layouts[0]!.elementPositions.title!
    expect(box.x + box.w).toBeLessThanOrEqual(1)
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })

  it('never emits a box of no size, which the schema rejects', () => {
    const { layouts } = buildTemplate(
      source(),
      [derived({ slots: [slot('title', { x: 0.1, y: 0.1, w: 0, h: 0 })] })],
      new Map(),
    )
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })
})

describe('the blank slate every template owes (TMPL-7)', () => {
  it('is synthesized, since no presentation has one to import', () => {
    const { layouts } = buildTemplate(source(), [derived()], new Map())
    const whiteboard = layouts.find(l => l.type === 'whiteboard')
    expect(whiteboard).toBeDefined()
    expect(whiteboard!.slots).toEqual([])
    expect(layoutSchema.safeParse(whiteboard).success).toBe(true)
  })

  it('comes last, being the least likely layout to want', () => {
    const { layouts } = buildTemplate(source(), [derived()], new Map())
    expect(layouts[layouts.length - 1]!.type).toBe('whiteboard')
  })

  it('is never displaced by a derived layout that wanted the same name', () => {
    // A slide the rules happen to call "whiteboard" must not become the blank
    // slate: two layouts sharing a type would make one unreachable
    const { layouts } = buildTemplate(
      source(),
      [derived({ type: 'whiteboard' })],
      new Map(),
    )
    expect(layouts.filter(l => l.type === 'whiteboard')).toHaveLength(1)
    expect(layouts.find(l => l.type === 'whiteboard')!.slots).toEqual([])
    expect(layouts.some(l => l.type === 'whiteboard-2')).toBe(true)
  })

  it('is not counted as a design the deck contained', () => {
    // The report says what was found in the presentation, and this was not
    const report = importReport(source(), [derived()], 0, 0)
    expect(report.layoutsCreated).toBe(1)
  })
})

describe('fonts', () => {
  it('map onto a stack the app already has, never one to be fetched', () => {
    // Fetching a font at display time leaks a view to a third party and
    // breaks the slide when that host is down. The keys are the template
    // editor's own (client/src/components/slide/fonts.ts).
    expect(mapFont('Playfair Display')).toBe('serif')
    expect(mapFont('Courier New')).toBe('mono')
    expect(mapFont('Montserrat')).toBe('geometric')
    expect(mapFont('Trebuchet MS')).toBe('humanist')
  })

  it('reads a monospaced family as monospaced even when its name says serif', () => {
    expect(mapFont('Courier New')).toBe('mono')
  })

  it('falls back to sans, which is what most presentation type is', () => {
    expect(mapFont('Some Unknown Face')).toBe('sans')
  })

  it('says nothing when the presentation named no font', () => {
    expect(mapFont(undefined)).toBeUndefined()
    expect(mapFont('  ')).toBeUndefined()
  })

  it('reaches the box it belongs to', () => {
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          slots: [
            slot(
              'title',
              { x: 0.08, y: 0.1, w: 0.84, h: 0.18 },
              { fontFamily: 'Georgia' },
            ),
          ],
        }),
      ],
      new Map(),
    )
    expect(layouts[0]!.elementPositions.title!.fontFamily).toBe('serif')
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })
})

describe('what the instructor is told', () => {
  it('counts what went in and what came out', () => {
    const report = importReport(
      source({
        slides: Array.from({ length: 38 }, (_, i) => ({
          id: `s${i}`,
          elements: [],
        })),
      }),
      [derived(), derived({ type: 'section', members: ['s3', 's4', 's5'] })],
      2,
      1,
    )
    expect(report).toMatchObject({
      slidesRead: 38,
      layoutsCreated: 2,
      approximated: 2,
      assetsFailed: 1,
    })
  })

  it('names the biggest merge, which is the one worth mentioning', () => {
    const report = importReport(
      source(),
      [
        derived({ members: ['a', 'b'] }),
        derived({
          type: 'section',
          members: Array.from({ length: 11 }, (_, i) => `x${i}`),
        }),
      ],
      0,
      0,
    )
    expect(report.largestMerge).toEqual({ type: 'section', slides: 11 })
  })

  it('mentions no merge when nothing merged', () => {
    const report = importReport(source(), [derived({ members: ['a'] })], 0, 0)
    expect(report.largestMerge).toBeUndefined()
  })
})

describe('the parts of a design that hold no content', () => {
  const stored = new Map([
    ['https://x/bg.jpg', 'https://cdn.test/templates/t1/0.jpg'],
    ['https://x/logo.png', 'https://cdn.test/templates/t1/1.png'],
  ])

  it('paints a page-filling picture behind everything', () => {
    const { layouts } = buildTemplate(
      source(),
      [derived({ backgroundImage: 'https://x/bg.jpg' })],
      new Map(),
      stored,
    )
    expect(layouts[0]!.decoration?.[0]).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      imageUrl: 'https://cdn.test/templates/t1/0.jpg',
    })
  })

  it('points at the template’s own copy, never the presentation’s', () => {
    // A presentation's image URLs are short-lived: a template that remembered
    // them would look right for an hour and then be full of holes
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          decoration: [
            {
              box: { x: 0.86, y: 0.87, w: 0.08, h: 0.07 },
              imageUrl: 'https://x/logo.png',
            },
          ],
        }),
      ],
      new Map(),
      stored,
    )
    expect(layouts[0]!.decoration?.[0]?.imageUrl).toBe(
      'https://cdn.test/templates/t1/1.png',
    )
  })

  it('keeps a band that is drawn from its fill', () => {
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          decoration: [
            { box: { x: 0, y: 0.9, w: 1, h: 0.02 }, fill: '#b45309' },
          ],
        }),
      ],
      new Map(),
      stored,
    )
    expect(layouts[0]!.decoration).toEqual([
      { x: 0, y: 0.9, w: 1, h: 0.02, fill: '#b45309' },
    ])
  })

  it('leaves out a picture that would not come, rather than pointing at it', () => {
    // Better an honest gap than a broken image on every slide
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          backgroundImage: 'https://x/missing.jpg',
          decoration: [
            {
              box: { x: 0.8, y: 0.8, w: 0.1, h: 0.1 },
              imageUrl: 'https://x/missing.png',
            },
          ],
        }),
      ],
      new Map(),
      stored,
    )
    expect(layouts[0]!.decoration).toBeUndefined()
  })

  it('produces decoration the template schema accepts', () => {
    const { layouts } = buildTemplate(
      source(),
      [
        derived({
          backgroundImage: 'https://x/bg.jpg',
          decoration: [
            { box: { x: 0, y: 0.9, w: 1, h: 0.02 }, fill: '#b45309' },
          ],
        }),
      ],
      new Map(),
      stored,
    )
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })

  it('says nothing at all when a design has none', () => {
    const { layouts } = buildTemplate(source(), [derived()], new Map())
    expect(layouts[0]!.decoration).toBeUndefined()
  })
})

/**
 * A box tall enough for what it holds.
 *
 * A source box is measured as the source drew it, and the two renderers do
 * not agree to the pixel: a box that fitted four points in Google Slides can
 * fit two here. An imported layout draws its boxes at a fixed height and
 * hides whatever runs past the edge, so the lecture was whole and looked cut
 * in half — the missing points were there, below the fold.
 */
describe('room for what the box actually held', () => {
  /** Four points of about seventy characters each, as the deck held them. */
  const held = { lines: 4, longest: 70 }

  const withBody = (h: number, over: Partial<CandidateSlot> = {}) =>
    derived({
      slots: [
        slot('title', { x: 0.08, y: 0.04, w: 0.84, h: 0.12 }, { fontSize: 5 }),
        slot(
          'body',
          { x: 0.08, y: 0.26, w: 0.84, h },
          { kind: 'bullets', fontSize: 2.5, held, ...over },
        ),
      ],
    })

  const bodyOf = (layout: Parameters<typeof buildTemplate>[1][number]) =>
    buildTemplate(source(), [layout], new Map()).layouts[0]!.elementPositions
      .body!

  it('grows a box too short to show its own content', () => {
    const box = bodyOf(withBody(0.14))
    expect(box.h).toBeGreaterThan(0.14)
  })

  it('leaves a box that already has the room exactly as it was drawn', () => {
    // The geometry IS the design. Growing one that fits would redraw a deck
    // that was never wrong.
    expect(bodyOf(withBody(0.6)).h).toBe(0.6)
  })

  it('does not move the box, only lengthens it', () => {
    expect(bodyOf(withBody(0.14))).toMatchObject({ x: 0.08, y: 0.26, w: 0.84 })
  })

  it('stops where the next box down begins', () => {
    // Growing through a footer would put the list on top of it, which is a
    // worse way to lose the words than hiding them.
    const layout = derived({
      slots: [
        slot(
          'body',
          { x: 0.08, y: 0.26, w: 0.84, h: 0.14 },
          { kind: 'bullets', fontSize: 2.5, held },
        ),
        slot(
          'footer',
          { x: 0.08, y: 0.5, w: 0.84, h: 0.08 },
          { fontSize: 1.5 },
        ),
      ],
    })
    const box = buildTemplate(source(), [layout], new Map()).layouts[0]!
      .elementPositions.body!
    expect(box.h).toBeLessThanOrEqual(0.5 - 0.26)
  })

  it('leaves a picture alone, which is drawn to fit its box', () => {
    const layout = derived({
      slots: [
        slot(
          'image',
          { x: 0.08, y: 0.26, w: 0.4, h: 0.14 },
          { kind: 'image', held },
        ),
      ],
    })
    expect(
      buildTemplate(source(), [layout], new Map()).layouts[0]!.elementPositions
        .image!.h,
    ).toBe(0.14)
  })

  it('still produces a layout the schema accepts', () => {
    const { layouts } = buildTemplate(source(), [withBody(0.14)], new Map())
    expect(layoutSchema.safeParse(layouts[0]).success).toBe(true)
  })
})
