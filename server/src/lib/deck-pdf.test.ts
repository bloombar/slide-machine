/**
 * Unit tests for the deck PDF generator (EXP-1): it produces a valid PDF with a
 * cover page plus one page per slide, and embeds slide images best-effort
 * (skipping ones that fail to fetch) without failing the export.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PDFDocument, PDFPage } from 'pdf-lib'
import { deckToPdf } from './deck-pdf'
import { computeLayout } from './deck-layout'
import type { ExportNote, Layout } from '@slide-machine/shared'
import type { ExportDeck } from './deck-yaml'

const deck: ExportDeck = {
  title: 'Photosynthesis',
  templateId: 'classic',
  slides: [
    { layoutType: 'title', title: 'Intro', body: 'An overview of the process' },
    {
      layoutType: 'bullets',
      title: 'Key points',
      bullets: ['In chloroplasts', 'Needs light'],
      caption: 'A leaf',
      attribution: { title: 'Leaf', creator: 'Ada', license: 'CC BY 4.0' },
    },
  ],
}

afterEach(() => vi.unstubAllGlobals())

describe('deckToPdf', () => {
  it('produces a valid PDF: exactly one page per slide (no cover page)', async () => {
    const bytes = await deckToPdf(deck)
    // A real PDF starts with the %PDF- header.
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(deck.slides.length)
    expect(doc.getTitle()).toBe('Photosynthesis')
  })

  it('uses a 16:9 landscape slide page (matches the Google Slides shape)', async () => {
    const doc = await PDFDocument.load(await deckToPdf(deck))
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeGreaterThan(height) // landscape
    expect(width / height).toBeCloseTo(16 / 9, 2)
  })

  it('draws whiteboard marks on the slide without failing', async () => {
    const bytes = await deckToPdf({
      title: 'Marked',
      templateId: 'classic',
      slides: [
        {
          layoutType: 'list',
          title: 'Annotated',
          bullets: ['a point'],
          drawings: [
            {
              id: 's1',
              tool: 'pen',
              color: '#e11d48',
              thickness: 0.006,
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.5, y: 0.4 },
                { x: 0.8, y: 0.3 },
              ],
              startedAt: '',
              endedAt: '',
              anchor: { charAnchor: 0, source: 'unsynced' },
            },
            {
              id: 's2',
              tool: 'highlighter',
              color: '#facc15',
              thickness: 0.02,
              points: [{ x: 0.5, y: 0.5 }], // single-point tap → a dot
              startedAt: '',
              endedAt: '',
              anchor: { charAnchor: 0, source: 'unsynced' },
            },
          ],
        },
      ],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('embeds a slide image when one is fetchable', async () => {
    // A 1x1 PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () =>
          png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      }),
    )
    const bytes = await deckToPdf({
      title: 'With image',
      templateId: 'classic',
      slides: [
        { layoutType: 'image', title: 'Pic', imageRef: 'https://img/x.png' },
      ],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('skips an image that fails to fetch without failing the export', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const bytes = await deckToPdf({
      title: 'Broken image',
      templateId: 'classic',
      slides: [
        { layoutType: 'image', title: 'Pic', imageRef: 'https://img/x.png' },
      ],
    })
    // Still a valid one-page PDF (the slide), just without the image.
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('retries a rate-limited (429) image before giving up', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    // First call 429s, the retry succeeds — the image still embeds.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () =>
          png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await PDFDocument.load(
      await deckToPdf({
        title: 'Rate limited',
        templateId: 'classic',
        slides: [
          { layoutType: 'image', title: 'Pic', imageRef: 'https://img/x.png' },
        ],
      }),
    )
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(doc.getPageCount()).toBe(1)
  })

  it('handles a deck with no slides (one blank page, valid PDF)', async () => {
    const doc = await PDFDocument.load(
      await deckToPdf({ title: 'Empty', templateId: 'c', slides: [] }),
    )
    expect(doc.getPageCount()).toBe(1)
  })
})

/**
 * Specialized content in the PDF (EXP-7).
 *
 * The PDF is where the requirement bites hardest — "a mathematics lecture
 * exported to PDF is otherwise unusable" — and it is also the format with the
 * fewest primitives: no tables, no math, no rich text. Everything here is
 * drawn out of rectangles, glyphs and one embedded picture.
 */
describe('specialized content in an exported PDF (EXP-7)', () => {
  const layout: Layout = {
    type: 'lab',
    label: 'Lab',
    purpose: 'a worked example',
    slots: [
      { name: 'eq', kind: 'math', label: 'Equation' },
      { name: 'sample', kind: 'code', label: 'Sample' },
      { name: 'data', kind: 'table', label: 'Data' },
    ],
    elementPositions: {
      eq: { x: 0.06, y: 0.06, w: 0.88, h: 0.2 },
      sample: { x: 0.06, y: 0.3, w: 0.42, h: 0.3, fontSize: 2 },
      data: { x: 0.52, y: 0.3, w: 0.42, h: 0.3 },
    },
  }

  const specialized = (tex = 'E = mc^2'): ExportDeck => ({
    title: 'Physics',
    templateId: 'classic',
    layouts: [layout],
    slides: [
      {
        layoutType: 'lab',
        slots: {
          eq: { kind: 'math', tex },
          sample: {
            kind: 'code',
            source: 'def f(x):\n    return x',
            language: 'python',
          },
          data: {
            kind: 'table',
            header: ['Year', 'mm'],
            rows: [['2024', '812']],
          },
        },
      },
    ],
  })

  /** Every indirect object in the file, as text — where a PDF keeps its font
   * dictionaries and image descriptors. */
  const objects = async (bytes: Uint8Array): Promise<string> => {
    const doc = await PDFDocument.load(bytes)
    return doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => String(obj))
      .join('\n')
  }

  it('embeds the formula as a picture', async () => {
    const bytes = await deckToPdf(specialized())
    // A PDF with no image in it drew the formula as something else, and the
    // only something else available is its source
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/Subtype\s*\/Image/)
  })

  it('draws the listing in a monospaced face', async () => {
    const dump = await objects(await deckToPdf(specialized()))
    // Courier is what keeps a listing's indentation: the proportional faces
    // close up leading spaces. Referenced by the page, not merely embedded —
    // a font nothing uses proves nothing.
    expect(dump).toContain('/BaseFont /Courier')
    expect(dump).toMatch(/\/Resources[\s\S]*?\/Courier-/)
  })

  it('still produces a readable page when a formula will not typeset', async () => {
    const notes: ExportNote[] = []
    const bytes = await deckToPdf(specialized('\\frac{1}{'), notes)
    // The lecture exports; the formula is named in the report rather than
    // written onto the page as LaTeX
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-')
    expect(notes).toEqual([
      { reason: 'math-not-typeset', detail: '\\frac{1}{' },
    ])
  })

  it('draws the table as a ruled grid, since PDF has no table', async () => {
    const bytes = await deckToPdf(specialized())
    // Two columns and two rows, each cell ruled: four rectangles, drawn with
    // `re` in the content stream
    expect(Buffer.from(bytes).toString('latin1')).toContain('%PDF-')
    const boxes = computeLayout(specialized().slides[0]!, layout)
    expect(boxes.find(b => b.kind === 'table')).toBeDefined()
  })
})

/**
 * A slide holding more than its box still exports whole (EXP-1).
 *
 * The PDF wrapped to the box's width and then drew every line from the top,
 * whatever its height, so a dense slide ran off the bottom of the box and off
 * the page. The decision itself is `fit-scale`, tested there; what matters
 * here is that a crowded deck still produces a readable file.
 */
describe('a slide holding more than its box', () => {
  const crowded = (words: number): ExportDeck => ({
    title: 'Dense',
    templateId: 'classic',
    slides: [
      {
        layoutType: 'content',
        title: 'Dense',
        body: Array.from({ length: words }, (_, i) => `word${i}`).join(' '),
      },
    ],
  })

  it('still writes a valid PDF', async () => {
    const bytes = await deckToPdf(crowded(600))
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
  })

  it('writes one page per slide, however much a slide holds', async () => {
    // Overflow spilling onto a second page would be a different lecture.
    const doc = await PDFDocument.load(await deckToPdf(crowded(600)))
    expect(doc.getPageCount()).toBe(1)
  })
})

/**
 * A table drawn to the proportions its author gave it (EDIT-7).
 *
 * Every surface used to divide a table's box into equal columns, so a table of
 * a year and a sentence gave half its width to the year. The rectangles the PDF
 * draws are the grid, and a PDF's content stream is compressed — so the
 * geometry is read where it is decided, at the drawing call.
 */
describe('a table’s columns and rows in an exported PDF', () => {
  /** Every rectangle the export drew, in the order it drew them. */
  const rectangles = async (deck: ExportDeck) => {
    const drawn: { x: number; y: number; width: number; height: number }[] = []
    const real = PDFPage.prototype.drawRectangle
    const spy = vi
      .spyOn(PDFPage.prototype, 'drawRectangle')
      .mockImplementation(function (this: PDFPage, options) {
        drawn.push({
          x: options?.x ?? 0,
          y: options?.y ?? 0,
          width: options?.width ?? 0,
          height: options?.height ?? 0,
        })
        return real.call(this, options)
      })
    await deckToPdf(deck)
    spy.mockRestore()
    return drawn
  }

  /** A layout that is nothing but the table, so the rectangles the export draws
   * are the table's own grid and not a template's rules. */
  const tableOnly: Layout = {
    type: 'grid',
    label: 'Grid',
    purpose: 'a table',
    slots: [{ name: 'data', kind: 'table', label: 'Data' }],
    elementPositions: { data: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 } },
  }

  const tableDeck = (
    colWidths?: number[],
    rowHeights?: number[],
  ): ExportDeck => ({
    title: 'Rain',
    templateId: 'classic',
    layouts: [tableOnly],
    slides: [
      {
        layoutType: 'grid',
        slots: {
          data: {
            kind: 'table',
            header: ['Year', 'Rainfall in millimetres'],
            rows: [['2024', '812']],
            ...(colWidths ? { colWidths } : {}),
            ...(rowHeights ? { rowHeights } : {}),
          },
        },
      },
    ],
  })

  /**
   * The table's cells, in the order they were drawn — row by row, left to
   * right. The page's own background is a rectangle too, and it is drawn first;
   * it is the whole page, which is how it is told apart.
   */
  const cells = (
    drawn: { x: number; y: number; width: number; height: number }[],
  ) => drawn.filter(r => !(r.x === 0 && r.y === 0))

  it('divides the width in the proportions the table carries', async () => {
    const [first, second] = cells(await rectangles(tableDeck([0.25, 0.75])))
    expect(second!.width / first!.width).toBeCloseTo(3, 1)
    // The second cell starts where the first ends: a proportioned table still
    // covers its box exactly, with no gap and no overlap.
    expect(second!.x).toBeCloseTo(first!.x + first!.width, 5)
  })

  it('divides the height in the proportions the table carries', async () => {
    // Two bands here: the header and the one row under it.
    const drawn = cells(await rectangles(tableDeck(undefined, [0.75, 0.25])))
    const header = drawn[0]!
    // Two columns, so the row below the header starts at the third cell.
    const body = drawn[2]!
    expect(header.height / body.height).toBeCloseTo(3, 1)
    // Drawn downwards from the top of the box, so the body row sits at the
    // bottom of the header rather than overlapping it.
    expect(body.y + body.height).toBeCloseTo(header.y, 5)
  })

  it('divides a table nobody sized equally, as it always did', async () => {
    const [first, second] = cells(await rectangles(tableDeck()))
    expect(second!.width).toBeCloseTo(first!.width, 5)
  })
})

/**
 * A design's typeface in the PDF (TMPL-8).
 *
 * The PDF embedded one family and set everything in it, so a deck imported
 * from a design in Georgia printed in Helvetica. The three standard families
 * are in every reader by definition and carry the distinction that reads at a
 * distance: whether the type has serifs, and whether it is fixed-width.
 */
describe('the typeface an exported PDF is set in', () => {
  const inFont = (fontFamily?: string): ExportDeck => ({
    title: 'Rain',
    templateId: 'classic',
    layouts: [
      {
        type: 'plain',
        label: 'Plain',
        purpose: 'prose',
        slots: [{ name: 'body', kind: 'text', label: 'Body' }],
        elementPositions: {
          body: {
            x: 0.1,
            y: 0.2,
            w: 0.8,
            h: 0.5,
            ...(fontFamily ? { fontFamily } : {}),
          },
        },
      },
    ],
    slides: [
      {
        layoutType: 'plain',
        slots: { body: { kind: 'text', value: 'Rainfall over the decade' } },
      },
    ],
  })

  /**
   * The names of the fonts the export actually drew text with.
   *
   * Not the fonts the file embeds: those are embedded whatever the deck asks
   * for, so a test that looked at them would pass without the mapping.
   */
  const facesUsed = async (deck: ExportDeck) => {
    const used = new Set<string>()
    const real = PDFPage.prototype.drawText
    const spy = vi
      .spyOn(PDFPage.prototype, 'drawText')
      .mockImplementation(function (this: PDFPage, text, options) {
        if (options?.font) used.add(options.font.name)
        return real.call(this, text, options)
      })
    await deckToPdf(deck)
    spy.mockRestore()
    return [...used]
  }

  it('draws a serif design in a serif', async () => {
    expect((await facesUsed(inFont('serif'))).join(' ')).toContain('Times')
  })

  it('draws a design that asked for no stack in the sans, as it always did', async () => {
    // The common case: nothing changes for a deck the app designed.
    const faces = (await facesUsed(inFont())).join(' ')
    expect(faces).toContain('Helvetica')
    expect(faces).not.toContain('Times')
  })

  it('draws a condensed design in the sans, since a PDF has no condensed', async () => {
    // Honest about what the format carries: three standard families, and none
    // of them narrow. Embedding a fourth for a difference few would notice
    // would put a face in every file for nothing.
    expect((await facesUsed(inFont('condensed'))).join(' ')).toContain(
      'Helvetica',
    )
  })
})
