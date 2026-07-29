/**
 * Unit tests for the deck PDF generator (EXP-1): it produces a valid PDF with a
 * cover page plus one page per slide, and embeds slide images best-effort
 * (skipping ones that fail to fetch) without failing the export.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { deckToPdf } from './deck-pdf'
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
