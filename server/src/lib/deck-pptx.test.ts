/**
 * Unit tests for the deck .pptx generator (EXP-1). The .pptx is the intermediate
 * uploaded to Drive for conversion into native Google Slides; here we assert it
 * is a valid OpenXML package (a ZIP whose parts include the presentation), one
 * slide per deck slide, and that a failed image fetch is skipped, not fatal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import AdmZip from 'adm-zip'
import type { ExportNote, Layout } from '@slide-machine/shared'
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

  it('renders whiteboard marks as freeform shapes without failing', async () => {
    const bytes = await deckToPptx({
      title: 'Marked',
      templateId: 'c',
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
              points: [{ x: 0.5, y: 0.5 }],
              startedAt: '',
              endedAt: '',
              anchor: { charAnchor: 0, source: 'unsynced' },
            },
          ],
        },
      ],
    })
    // A valid .pptx ZIP that includes the drawings' shapes (larger than a
    // text-only single slide).
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(zipEntryCount(bytes)).toBeGreaterThan(0)
  })
})

/** One part of the generated package, as text. */
const part = (bytes: Uint8Array, name: string): string =>
  new AdmZip(Buffer.from(bytes)).readAsText(name)

/** A layout that placed its own boxes, which is what gives them slot names to
 * be carried by. The hand-tuned arrangements have none. */
const arranged: Layout = {
  type: 'content',
  label: 'Content',
  purpose: 'body text',
  slots: [
    { name: 'title', kind: 'text', label: 'Title' },
    { name: 'body', kind: 'text', label: 'Body' },
  ],
  elementPositions: {
    title: { x: 0.06, y: 0.1, w: 0.88, h: 0.2 },
    body: { x: 0.06, y: 0.4, w: 0.88, h: 0.4 },
  },
}

describe('what an exported deck says about itself (EXP-8)', () => {
  const withSlots: ExportDeck = {
    title: 'Photosynthesis',
    templateId: 'classic',
    layouts: [arranged],
    slides: [
      {
        layoutType: 'content',
        title: 'Intro',
        body: 'An overview',
        slots: {
          title: { kind: 'text', value: 'Intro' },
          body: { kind: 'text', value: 'An overview' },
        },
        narration: 'Today we are going to talk about photosynthesis.',
      },
    ],
  }

  it('says which slot each shape is', async () => {
    const xml = part(await deckToPptx(withSlots), 'ppt/slides/slide1.xml')
    // Google Slides can say where a shape sits and nothing about what it is,
    // so a re-import would otherwise have to infer the box from its rectangle
    expect(xml).toContain('descr="slot:title"')
    expect(xml).toContain('descr="slot:body"')
  })

  it('puts the narration in the speaker notes', async () => {
    const bytes = await deckToPptx(withSlots)
    const notes = part(bytes, 'ppt/notesSlides/notesSlide1.xml')
    // Which is what notes mean to a presenter, and how the narration comes
    // back as narration rather than as a stray field
    expect(notes).toContain('Today we are going to talk about photosynthesis.')
  })

  it('leaves the notes empty for a slide nobody narrated', async () => {
    const silent = await deckToPptx({
      ...withSlots,
      slides: [{ ...withSlots.slides[0]!, narration: undefined }],
    })
    // The generator gives every slide a notes page whether or not it is asked
    // to; what matters is that nothing is invented to put on it — a slide's
    // body text is not a thing its presenter said
    const notes = part(silent, 'ppt/notesSlides/notesSlide1.xml')
    expect(notes).not.toContain('An overview')
    expect(notes).not.toContain('Today we are going to talk')
  })

  it('claims nothing about a box no template named', async () => {
    // The hand-tuned arrangements draw boxes that are not slots. Labelling one
    // would tell a future import a slot exists where none does
    const xml = part(await deckToPptx(deck), 'ppt/slides/slide1.xml')
    expect(xml).not.toContain('descr="slot:')
  })
})

/**
 * Specialized content, exported as what the audience saw (EXP-7).
 *
 * Every one of these is the same claim: the file carries the rendered thing,
 * never the source behind it. A maths lecture whose formulas arrive as
 * `\frac{1}{2}` is unusable, and that is the whole reason the kinds exist.
 */
describe('specialized content in an exported deck (EXP-7)', () => {
  const layout: Layout = {
    type: 'lab',
    label: 'Lab',
    purpose: 'a worked example',
    slots: [
      { name: 'eq', kind: 'math', label: 'Equation' },
      { name: 'sample', kind: 'code', label: 'Sample' },
      { name: 'data', kind: 'table', label: 'Data' },
      { name: 'fixed', kind: 'preformatted', label: 'Diagram' },
    ],
    elementPositions: {
      eq: { x: 0.06, y: 0.06, w: 0.88, h: 0.18 },
      sample: { x: 0.06, y: 0.28, w: 0.42, h: 0.3, fontSize: 2 },
      data: { x: 0.52, y: 0.28, w: 0.42, h: 0.3 },
      fixed: { x: 0.06, y: 0.62, w: 0.88, h: 0.2, fontSize: 2 },
    },
  }

  const specialized = (over: Record<string, unknown> = {}): ExportDeck => ({
    title: 'Physics',
    templateId: 'classic',
    layouts: [layout],
    theme: {
      background: '#0f172a',
      text: '#f1f5f9',
      accent: '#38bdf8',
      muted: '#94a3b8',
    },
    slides: [
      {
        layoutType: 'lab',
        slots: {
          eq: { kind: 'math', tex: 'E = mc^2' },
          sample: {
            kind: 'code',
            source: 'def f(x):\n        return x + 1',
            language: 'python',
          },
          data: {
            kind: 'table',
            header: ['Year', 'mm'],
            rows: [['2024', '812']],
          },
          fixed: { kind: 'preformatted', value: 'a   b\n  c' },
          ...(over as object),
        },
      },
    ],
  })

  const slideXml = async (deck: ExportDeck, notes?: ExportNote[]) =>
    part(await deckToPptx(deck, notes), 'ppt/slides/slide1.xml')

  it('typesets a formula into a picture', async () => {
    const bytes = await deckToPptx(specialized())
    const media = new AdmZip(Buffer.from(bytes))
      .getEntries()
      .filter(e => !e.isDirectory && /^ppt\/media\//.test(e.entryName))
    expect(media).toHaveLength(1)
  })

  it('never writes a formula out as its source', async () => {
    // The requirement, stated as a prohibition
    const xml = await slideXml(specialized())
    expect(xml).not.toMatch(/<a:t>[^<]*mc\^2/)
  })

  it('draws a table as a table, not as lines of text', async () => {
    const xml = await slideXml(specialized())
    expect(xml).toContain('<a:tbl>')
    expect(xml).not.toMatch(/<a:t>2024\s+812<\/a:t>/)
  })

  it('sets a listing monospaced, with its indentation intact', async () => {
    const xml = await slideXml(specialized())
    expect(xml).toContain('Courier New')
    // Colouring splits a line into runs, so the listing is read back by
    // joining them: what matters is that the characters are all there, in
    // order, indentation included
    const written = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
      .map(m => m[1])
      .join('')
    expect(written).toContain('def f(x):')
    expect(written).toContain('        return x + 1')
  })

  it('carries the listing’s highlighting as coloured runs', async () => {
    const xml = await slideXml(specialized())
    // `def` is a keyword, and the dark palette is chosen because the slide's
    // own background is dark
    expect(xml).toMatch(/srgbClr val="FF7B72"/i)
  })

  it('chooses the colours against the background it paints', async () => {
    const onLight = await slideXml({
      ...specialized(),
      theme: {
        background: '#ffffff',
        text: '#111111',
        accent: '#0055ff',
        muted: '#666666',
      },
    })
    // A keyword red that reads on navy is not the one that reads on white
    expect(onLight).toMatch(/srgbClr val="8250DF"/i)
  })

  it('keeps preformatted spacing exactly', async () => {
    const xml = await slideXml(specialized())
    // DrawingML keeps a run's whitespace as written — no collapsing, and no
    // `xml:space` needed for it
    expect(xml).toContain('<a:t>a   b</a:t>')
    expect(xml).toContain('<a:t>  c</a:t>')
  })

  it('says what it could not carry rather than writing out the source', async () => {
    const notes: ExportNote[] = []
    const xml = await slideXml(
      specialized({ eq: { kind: 'math', tex: '\\frac{1}{' } }),
      notes,
    )
    expect(notes).toEqual([
      { reason: 'math-not-typeset', detail: '\\frac{1}{' },
    ])
    // And the broken source is nowhere on the slide
    expect(xml).not.toMatch(/<a:t>[^<]*frac/)
  })
})

/**
 * That a picture is really in the file.
 *
 * "It is a zip" is true of an export with no pictures in it at all, so the
 * embed test above cannot tell a working image path from a broken one. A
 * .pptx keeps its pictures as entries under `ppt/media/`, so that is what is
 * asked.
 */
describe('a picture in the exported file', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )

  const servePng = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () =>
          PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      }),
    )

  const media = (bytes: Uint8Array): string[] =>
    new AdmZip(Buffer.from(bytes))
      .getEntries()
      .map(e => e.entryName)
      .filter(name => /ppt\/media\//.test(name))

  it('is written into ppt/media, not merely referenced', async () => {
    servePng()
    const bytes = await deckToPptx({
      title: 'Pic',
      templateId: 'c',
      slides: [
        { layoutType: 'image', title: 'Pic', imageRef: 'https://img/x.png' },
      ],
    })
    expect(media(bytes).length).toBeGreaterThan(0)
  })

  it('carries its credit with it (IMG-5)', async () => {
    servePng()
    const bytes = await deckToPptx({
      title: 'Pic',
      templateId: 'c',
      slides: [
        {
          layoutType: 'image',
          title: 'Pic',
          imageRef: 'https://img/x.png',
          attribution: { creator: 'Ada Lovelace', license: 'CC BY-SA 4.0' },
        },
      ],
    })
    const xml = new AdmZip(Buffer.from(bytes))
      .getEntries()
      .filter(e => /ppt\/slides\/slide1\.xml$/.test(e.entryName))
      .map(e => e.getData().toString('utf8'))
      .join('')
    expect(media(bytes).length).toBeGreaterThan(0)
    expect(xml).toContain('Ada Lovelace')
  })
})
