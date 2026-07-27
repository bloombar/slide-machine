/**
 * Unit tests for the deck .pptx generator (EXP-1). The .pptx is the intermediate
 * uploaded to Drive for conversion into native Google Slides; here we assert it
 * is a valid OpenXML package (a ZIP whose parts include the presentation), one
 * slide per deck slide, and that a failed image fetch is skipped, not fatal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { deckToPptx } from './deck-pptx'
import type { ExportDeck } from './deck-yaml'

const deck: ExportDeck = {
  title: 'Photosynthesis',
  templateId: 'classic',
  slides: [
    { layoutType: 'title', title: 'Intro', body: 'An overview' },
    {
      layoutType: 'list',
      title: 'Key points',
      bullets: ['In chloroplasts', 'Needs light'],
      caption: 'A leaf',
      attribution: { creator: 'Ada', license: 'CC BY 4.0' },
    },
  ],
}

/** Reads the little-endian uint32 count of central-directory entries from a
 * ZIP's End Of Central Directory record — i.e. how many files the .pptx packs.
 * Used to sanity-check that more slides produce a larger package. */
const zipEntryCount = (bytes: Uint8Array): number => {
  // EOCD signature 0x06054b50; total entries is a uint16 at offset 10.
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return bytes[i + 10]! | (bytes[i + 11]! << 8)
    }
  }
  return 0
}

afterEach(() => vi.unstubAllGlobals())

describe('deckToPptx', () => {
  it('produces a valid OpenXML (.pptx ZIP) package', async () => {
    const bytes = await deckToPptx(deck)
    // ZIP local-file-header magic "PK\x03\x04".
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(zipEntryCount(bytes)).toBeGreaterThan(0)
  })

  it('adds one slide per deck slide (more slides → larger package)', async () => {
    const one = await deckToPptx({
      title: 'One',
      templateId: 'c',
      slides: [{ layoutType: 'title', title: 'A' }],
    })
    const three = await deckToPptx({
      title: 'Three',
      templateId: 'c',
      slides: [
        { layoutType: 'title', title: 'A' },
        { layoutType: 'title', title: 'B' },
        { layoutType: 'title', title: 'C' },
      ],
    })
    expect(zipEntryCount(three)).toBeGreaterThan(zipEntryCount(one))
  })

  it('embeds a fetchable image', async () => {
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
    const bytes = await deckToPptx({
      title: 'Pic',
      templateId: 'c',
      slides: [
        { layoutType: 'image', title: 'Pic', imageRef: 'https://img/x.png' },
      ],
    })
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('skips an image that fails to fetch without failing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const bytes = await deckToPptx({
      title: 'Broken',
      templateId: 'c',
      slides: [
        { layoutType: 'image', title: 'Pic', imageRef: 'https://img/x.png' },
      ],
    })
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })
})
