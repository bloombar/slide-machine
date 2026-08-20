/**
 * A branded deck, imported end to end (TMPL-8).
 *
 * The design of an institution's template is almost entirely pictures: a crest
 * in one corner, a wordmark in another, a pattern of rules behind the type.
 * None of it is on any slide — an author draws it once on the layout or the
 * master — and much of it is grouped, because that is how anyone who draws a
 * crest beside a wordmark keeps the two together.
 *
 * Every one of those was dropped. Inherited pictures were not decoration,
 * grouped shapes were not read at all, a decoration piece lost its picture on
 * the way into a candidate, and the fetch only ever looked at slides. A deck
 * imported as a flat colour with nothing on it.
 *
 * This drives the whole chain — Google's own shape in, a stored template out —
 * because each stage passed its own tests while the deck still came back
 * blank.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WHITEBOARD_LAYOUT_TYPE,
  type LayoutDecoration,
} from '@slide-machine/shared'
import { toSourcePresentation } from './read-slides'
import { importSourcePresentation } from './import-presentation'

const put = vi.fn()
vi.mock('../storage', () => ({
  getStorage: () => ({
    put,
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  }),
}))

const EMU = 914400

const at = (x: number, y: number, w: number, h: number) => ({
  transform: {
    translateX: x * EMU,
    translateY: y * EMU,
    scaleX: 1,
    scaleY: 1,
    unit: 'EMU',
  },
  size: {
    width: { magnitude: w * EMU, unit: 'EMU' },
    height: { magnitude: h * EMU, unit: 'EMU' },
  },
})

/** The crest and the wordmark, grouped as an author would group them. */
const brandMark = {
  objectId: 'brand',
  ...at(8, 4.6, 1.6, 0.6),
  elementGroup: {
    children: [
      {
        objectId: 'crest',
        ...at(0, 0, 0.6, 0.6),
        image: { contentUrl: 'https://google.invalid/crest.png' },
      },
      {
        objectId: 'wordmark',
        ...at(0.7, 0.1, 0.9, 0.4),
        image: { contentUrl: 'https://google.invalid/wordmark.png' },
      },
    ],
  },
}

/** The pattern of rules the whole deck is printed over, on the master. */
const backdrop = {
  objectId: 'pattern',
  ...at(0, 0, 10, 5.625),
  image: { contentUrl: 'https://google.invalid/pattern.png' },
}

const title = (id: string) => ({
  objectId: id,
  ...at(1, 2, 8, 1),
  shape: {
    placeholder: { type: 'TITLE' },
    text: {
      textElements: [
        { paragraphMarker: {} },
        {
          textRun: {
            content: 'Title Page',
            style: { fontSize: { magnitude: 40, unit: 'PT' } },
          },
        },
      ],
    },
  },
})

const deck = () => ({
  presentationId: 'p1',
  title: 'Branded deck',
  pageSize: {
    width: { magnitude: 10 * EMU, unit: 'EMU' },
    height: { magnitude: 5.625 * EMU, unit: 'EMU' },
  },
  masters: [{ objectId: 'm1', pageElements: [backdrop] }],
  layouts: [
    {
      objectId: 'l1',
      layoutProperties: { masterObjectId: 'm1', displayName: 'TITLE' },
      pageElements: [brandMark],
    },
  ],
  slides: ['s1', 's2', 's3'].map(id => ({
    objectId: id,
    slideProperties: { layoutObjectId: 'l1', masterObjectId: 'm1' },
    pageElements: [title(`${id}-t`)],
  })),
})

beforeEach(() => {
  put.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: {
        get: (n: string) => (n === 'content-type' ? 'image/png' : null),
      },
      arrayBuffer: async () => Buffer.from([1, 2, 3]).buffer,
    })) as unknown as typeof fetch,
  )
})
afterEach(() => vi.unstubAllGlobals())

const imported = async () => {
  const { template } = await importSourcePresentation(
    toSourcePresentation(deck() as unknown as Record<string, unknown>),
    { assetPrefix: 'templates/import/u1/p1' },
  )
  return template.layouts.find(l => l.type !== WHITEBOARD_LAYOUT_TYPE)!
}

/** The box of each decoration piece, in the order it is painted. */
const boxes = (layout: { decoration?: LayoutDecoration[] }) =>
  (layout.decoration ?? []).map(d => ({ x: d.x, y: d.y, w: d.w, h: d.h }))

describe('a deck whose design lives on its layout and master', () => {
  it('brings across every picture the design draws', async () => {
    const design = await imported()
    expect(design.decoration).toHaveLength(3)
  })

  it('points each one at the template’s own stored copy', async () => {
    const design = await imported()
    for (const piece of design.decoration ?? []) {
      expect(piece.imageUrl).toMatch(
        /^https:\/\/cdn\.test\/templates\/import\/u1\/p1\//,
      )
    }
  })

  it('paints the master’s backdrop behind the layout’s mark', async () => {
    // Order is paint order. A full-bleed pattern drawn last would cover the
    // crest it is meant to sit behind.
    expect(boxes(await imported())[0]).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('keeps the two halves of a grouped mark where the group put them', async () => {
    // The crest sits at the group's own offset; the wordmark further in. Read
    // without the group, both would land where they sit INSIDE it — the crest
    // in the top-left corner of the slide.
    const marks = (await imported()).decoration!.slice(1)
    expect(marks[0]!.x).toBeCloseTo(0.8, 5)
    expect(marks[1]!.x).toBeCloseTo(0.87, 5)
  })

  it('fetches each picture once, not once per slide', async () => {
    await imported()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('asks the author to fill in the title, and nothing else', async () => {
    // The crest is the design's. Read as content it becomes a box the AI
    // writes into on every slide of the lecture.
    const design = await imported()
    expect(design.slots.map(s => s.name)).toEqual(['title'])
  })
})
