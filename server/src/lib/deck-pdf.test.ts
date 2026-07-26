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
  it('produces a valid PDF: a cover page plus one page per slide', async () => {
    const bytes = await deckToPdf(deck)
    // A real PDF starts with the %PDF- header.
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(deck.slides.length + 1)
    expect(doc.getTitle()).toBe('Photosynthesis')
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
    expect(doc.getPageCount()).toBe(2)
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
    // Still a valid two-page PDF (cover + slide), just without the image.
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
  })

  it('handles a deck with no slides (just a cover)', async () => {
    const doc = await PDFDocument.load(
      await deckToPdf({ title: 'Empty', templateId: 'c', slides: [] }),
    )
    expect(doc.getPageCount()).toBe(1)
  })
})
