/**
 * One import driven from a raw Google Slides response, end to end (TMPL-8).
 *
 * Every other test in this directory starts from a `SourcePresentation` — the
 * shape this system has already normalized a deck into. That is a comfortable
 * place to start and it is precisely where the import bugs users hit were
 * invisible: the reader was never in the picture, so a slide's collapsed
 * geometry and a master's missing colour could not show up.
 *
 * This one starts where a real import starts: the JSON Google returns. The
 * fixture is shaped the way a real response is — slide placeholders carrying
 * text and a `parentObjectId` and nothing else, the deck's colour on the
 * master, prompt text on the layouts — and it runs the whole pipeline over it,
 * to a finished template.
 *
 * ## Replace the fixture with your own
 *
 * `scripts/capture-google-presentation.mjs` writes the same JSON from a real
 * presentation. Point `FIXTURE` at what it produced and this suite runs
 * against a real deck — which is the point: a hand-written fixture only
 * contains the shapes whoever wrote it already knew about.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { toSourcePresentation } from './read-slides'
import { importSourcePresentation } from './import-presentation'
import { layoutSchema } from '../templates/builtin'
import type { ImportResult } from './import-presentation'
import type { SourcePresentation } from './source-presentation'

// No pictures are fetched: the import is run without an assetPrefix, so
// nothing here touches the network or storage.
vi.mock('../storage', () => ({
  getStorage: () => ({
    put: vi.fn(),
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  }),
}))

const FIXTURE = new URL(
  '../../test/fixtures/presentation-urban-hydrology.json',
  import.meta.url,
)

const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>

let source: SourcePresentation
let result: ImportResult

beforeAll(async () => {
  source = toSourcePresentation(raw)
  // No provider: naming layouts is the one pass an import must survive
  // without, so the fixture run is the rule-based path.
  result = await importSourcePresentation(source)
})

describe('reading a real presentation', () => {
  it('finds every slide and the layouts they were built on', () => {
    expect(source.slides).toHaveLength(6)
    expect(source.layouts).toHaveLength(2)
    expect(source.slides.every(s => Boolean(s.layoutId))).toBe(true)
  })

  it('paints the deck the colour its master states', () => {
    // Not one slide states a background — they all say INHERIT, which is what
    // a real deck looks like. Read without the walk, this deck is white.
    expect(source.theme.background).toBe('#0d1a66')
    expect(source.slides.every(s => s.background === '#0d1a66')).toBe(true)
  })

  it('gives every box a real place on the page', () => {
    // The collapse: a placeholder that states no size is not a shape at the
    // origin with no width
    const boxes = source.slides.flatMap(s => s.elements.map(e => e.box))
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) {
      expect(box.w).toBeGreaterThan(0)
      expect(box.h).toBeGreaterThan(0)
      expect(box.x + box.w).toBeLessThanOrEqual(1)
      expect(box.y + box.h).toBeLessThanOrEqual(1)
    }
    // And not all in one place, which a single inherited box would look like
    expect(new Set(boxes.map(b => `${b.x},${b.y}`)).size).toBeGreaterThan(1)
  })

  it('sets the type the way the deck sets it', () => {
    const heading = source.slides[1]!.elements.find(
      e => e.placeholder === 'TITLE',
    )
    // 30pt from the layout, bold and Georgia from the master behind it
    expect(heading?.runs?.[0]).toMatchObject({
      text: 'Where the water goes',
      fontSize: 4.17,
      bold: true,
      fontFamily: 'Georgia',
      color: '#ffffff',
    })
  })

  it('centres the title slide, which only its layout says to do', () => {
    const heading = source.slides[0]!.elements.find(
      e => e.placeholder === 'CENTERED_TITLE',
    )
    expect(heading?.align).toBe('center')
    expect(heading?.vAlign).toBe('center')
  })

  it('takes the lecturer’s words and none of Google’s', () => {
    const said = source.slides.flatMap(s =>
      s.elements.flatMap(e => e.runs?.map(r => r.text) ?? []),
    )
    expect(said).toContain('Urban Hydrology')
    expect(said.some(t => t.includes('Click to edit'))).toBe(false)
  })

  it('keeps the picture, the rule and the speaker notes', () => {
    const kinds = source.slides.flatMap(s => s.elements.map(e => e.kind))
    expect(kinds).toContain('image')
    expect(kinds).toContain('decoration')
    expect(source.slides[0]!.notes).toContain('Where the rain goes')
  })
})

/** The layouts the deck produced. Every template carries a whiteboard canvas
 * whatever it was imported from, so it is not one of them. */
const derived = () =>
  result.template.layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)

describe('the design that import derives from it', () => {
  it('produces layouts that pass the template schema', () => {
    expect(result.template.layouts.length).toBeGreaterThan(0)
    for (const layout of result.template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })

  it('groups the deck by the layouts its author actually used', () => {
    // Five slides on TITLE_AND_BODY and one on TITLE: the author already did
    // the work consolidation exists to do, so it is not redone worse
    expect(derived()).toHaveLength(2)
    expect(result.report.slidesRead).toBe(6)
    expect(result.report.largestMerge?.slides).toBe(5)
    expect(result.report.approximated).toBe(0)
  })

  it('gives back every slide when the author asks for that', async () => {
    // The same deck, imported the other way: one layout per slide (TMPL-8)
    const every = await importSourcePresentation(source, {
      keepEverySlide: true,
    })
    expect(
      every.template.layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE),
    ).toHaveLength(6)
    expect(every.report.layoutsCreated).toBe(6)
  })

  it('carries the deck’s colour onto the template', () => {
    expect(result.template.theme.background).toBe('#0d1a66')
  })

  it('places every box somewhere a reader would look', () => {
    // The visible failure this guards: a design whose boxes all collapsed
    // into the top-left corner
    for (const layout of derived()) {
      const positions = Object.values(layout.elementPositions ?? {})
      expect(positions.length).toBeGreaterThan(0)
      for (const position of positions) {
        expect(position.w).toBeGreaterThan(0.01)
        expect(position.h).toBeGreaterThan(0.005)
      }
      // Nothing is stacked in the corner
      const corner = positions.filter(p => p.x < 0.01 && p.y < 0.01)
      expect(corner.length).toBeLessThan(2)
    }
  })

  it('gives each layout boxes for what its slides hold', () => {
    for (const layout of derived()) {
      expect(layout.slots.length).toBeGreaterThan(0)
      // Every box the design declares has somewhere to be drawn
      for (const slot of layout.slots) {
        expect(layout.elementPositions?.[slot.name]).toBeDefined()
      }
    }
  })

  it('sets each box in the type the deck sets it in', () => {
    // Type size, weight, family and colour all reach the design — and every
    // one of them was stated a page or two above the slide
    const heading = derived()
      .flatMap(l => Object.entries(l.elementPositions ?? {}))
      .find(([name]) => name === 'title')?.[1]
    expect(heading).toMatchObject({
      fontWeight: 700,
      color: '#ffffff',
      fontFamily: 'serif',
    })
    expect(heading?.fontSize).toBeGreaterThan(3)
  })
})
