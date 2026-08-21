/**
 * The pictures a design draws, in the exported files (TMPL-8/EXP-1).
 *
 * An institution's design is mostly pictures — a crest in the corner, a
 * backdrop behind the type — and the exporters drew only the decoration that
 * carried a `fill`. So an imported deck exported with its branding taken off:
 * the same slides, on a blank page.
 *
 * Driven through both writers, because the Google Slides export is a .pptx
 * uploaded for conversion (`export-google`) — so these two cover all three
 * formats an instructor can ask for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PDFPage, type PDFImage } from 'pdf-lib'
import type { Layout } from '@slide-machine/shared'

/** A 1×1 PNG, which is a real enough picture for pdf-lib and pptxgenjs. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const get = vi.fn()
vi.mock('../storage', () => ({
  getStorage: () => ({
    get,
    publicUrl: (key: string) => `/api/files/${key}`,
  }),
}))

const { deckToPdf } = await import('./deck-pdf')
const { deckToPptx } = await import('./deck-pptx')
const { computeLayout } = await import('./deck-layout')

/** A design whose crest and backdrop live on the layout, as an import leaves
 * them: pointing at the template's own stored copies. */
const branded: Layout = {
  type: 'branded',
  label: 'Branded',
  purpose: 'a slide',
  slots: [{ name: 'body', kind: 'text', label: 'Body' }],
  elementPositions: { body: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } },
  decoration: [
    { x: 0, y: 0, w: 1, h: 1, imageUrl: '/api/files/t1/backdrop.png' },
    { x: 0.86, y: 0.88, w: 0.1, h: 0.08, imageUrl: '/api/files/t1/crest.png' },
  ],
}

/** Three slides on the one design — the case that must not cost three
 * downloads of the same crest. */
const deck = {
  title: 'Branded',
  templateId: 'imported',
  layouts: [branded],
  slides: ['one', 'two', 'three'].map(value => ({
    layoutType: 'branded',
    slots: { body: { kind: 'text' as const, value } },
  })),
}

beforeEach(() => {
  get.mockReset()
  get.mockResolvedValue(PNG)
})

describe('a design’s pictures in the exported PDF', () => {
  it('draws every one of them', async () => {
    const drawn: { width: number; height: number }[] = []
    const spy = vi
      .spyOn(PDFPage.prototype, 'drawImage')
      .mockImplementation(function (
        this: PDFPage,
        _image: PDFImage,
        options?: { width?: number; height?: number },
      ) {
        drawn.push({ width: options?.width ?? 0, height: options?.height ?? 0 })
      } as never)
    try {
      await deckToPdf(deck)
    } finally {
      spy.mockRestore()
    }
    // Two pieces on each of three slides.
    expect(drawn).toHaveLength(6)
  })

  it('stretches a full-bleed backdrop to the page rather than fitting it', () => {
    // The box IS the rectangle the design drew the picture at. Fitted, a
    // backdrop would be letterboxed and a crest would float inside its own
    // outline — neither is what the deck looks like.
    const [backdrop] = computeLayout(deck.slides[0]!, branded).filter(
      b => b.kind === 'image',
    )
    expect(backdrop).toMatchObject({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('fetches each distinct picture once, not once per slide', async () => {
    const spy = vi
      .spyOn(PDFPage.prototype, 'drawImage')
      .mockImplementation((() => {}) as never)
    try {
      await deckToPdf(deck)
    } finally {
      spy.mockRestore()
    }
    // Three slides, two pictures, two reads.
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('exports the deck anyway when a picture will not come', async () => {
    // One unreachable logo must not cost an instructor their file.
    get.mockResolvedValue(undefined)
    const bytes = await deckToPdf(deck)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})

describe('a design’s pictures in the exported .pptx', () => {
  /** A pptx is a zip, and its parts are named in the archive — so a picture
   * that reached the file is a `ppt/media/` entry in it. */
  const mediaCount = (bytes: Uint8Array): number =>
    (
      Buffer.from(bytes)
        .toString('latin1')
        .match(/ppt\/media\/image/g) ?? []
    ).length

  it('puts them in the file', async () => {
    expect(mediaCount(await deckToPptx(deck))).toBeGreaterThan(0)
  })

  it('carries none of them when the design draws none', async () => {
    const plain = {
      ...deck,
      layouts: [{ ...branded, decoration: undefined }],
    }
    expect(mediaCount(await deckToPptx(plain))).toBe(0)
  })

  it('exports the deck anyway when a picture will not come', async () => {
    get.mockResolvedValue(undefined)
    expect((await deckToPptx(deck)).byteLength).toBeGreaterThan(0)
  })
})
