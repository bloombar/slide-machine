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
import { parseSlotMetadata } from './slot-metadata'
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

  it('divides a table in the proportions it was given', async () => {
    // pptxgenjs divides the box equally when it is told nothing, so a table
    // the author sized used to arrive in Slides re-divided (EDIT-7).
    const sized = specialized()
    sized.slides[0]!.slots!.data = {
      kind: 'table',
      header: ['Year', 'Rainfall in millimetres'],
      rows: [['2024', '812']],
      colWidths: [0.25, 0.75],
    }
    const xml = await slideXml(sized)
    // The grid states each column's width, in EMU.
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"/g)].map(m =>
      Number(m[1]),
    )
    expect(widths).toHaveLength(2)
    expect(widths[1]! / widths[0]!).toBeCloseTo(3, 1)
  })

  it('divides a table nobody sized equally, as it always did', async () => {
    const widths = [
      ...(await slideXml(specialized())).matchAll(/<a:gridCol w="(\d+)"/g),
    ].map(m => Number(m[1]))
    expect(widths).toHaveLength(2)
    expect(widths[0]).toBe(widths[1])
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

/**
 * The two shapes EXP-1 offers.
 *
 * A flat deck bakes the formatting into each slide and carries no reusable
 * layouts — right for handing someone a finished lecture. A deck carrying
 * layouts writes the template as the presentation's own layout pages and
 * attaches each slide to the one it uses, which is what lets Google Slides
 * restyle it and what lets a re-import group by the author's own design
 * rather than clustering the slides afresh (TMPL-8).
 *
 * Without the second shape, a lecture exported and imported back came home
 * rearranged: the importer had nothing to group by.
 *
 * pptxgenjs writes a defined master as a *slide layout* under the one master
 * the package always has, so that is where these look.
 */
describe('a deck carrying its reusable layouts', () => {
  const withLayouts: ExportDeck = {
    title: 'Photosynthesis',
    templateId: 'classic',
    layouts: [
      {
        type: 'title',
        label: 'Title',
        purpose: 'Opening slide',
        slots: [{ name: 'title', kind: 'text', label: 'Title' }],
        elementPositions: { title: { x: 0.08, y: 0.4, w: 0.84, h: 0.2 } },
      },
    ] as Layout[],
    templateTheme: { background: '#ffffff', text: '#111111' },
    // A slide arranged by a template carries its content per slot, which is
    // what `computeLayout` reads.
    slides: [
      {
        layoutType: 'title',
        title: 'Photosynthesis',
        slots: { title: { kind: 'text', value: 'Photosynthesis' } },
      },
    ],
  }

  /** The layout pages a .pptx declares, by their XML. */
  const layoutParts = (bytes: Uint8Array): string[] =>
    new AdmZip(Buffer.from(bytes))
      .getEntries()
      .filter(e => /ppt\/slideLayouts\/.*\.xml$/.test(e.entryName))
      .map(e => e.getData().toString('utf8'))

  it('declares no reusable layout by default, which is the flat deck', async () => {
    // The one layout is the package's own default, not the template's.
    const parts = layoutParts(await deckToPptx(withLayouts))
    expect(parts).toHaveLength(1)
    expect(parts[0]).not.toContain('slot:title')
  })

  it('writes the template as a layout page when asked', async () => {
    const parts = layoutParts(await deckToPptx(withLayouts, undefined, true))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toContain('name="TITLE"')
  })

  /**
   * The declaration the importer reads back. This is the round trip: the same
   * `slidemachine` block `authoredLayouts` looks for when deciding whether a
   * presentation carries its own design or needs clustering.
   */
  it('carries the slot declaration a re-import groups by', async () => {
    const xml = layoutParts(
      await deckToPptx(withLayouts, undefined, true),
    ).join('')
    expect(xml).toContain('slidemachine')
    expect(xml).toContain('slot:title')
  })

  it('attaches the slide to that layout rather than the default', async () => {
    const bytes = await deckToPptx(withLayouts, undefined, true)
    const rels = new AdmZip(Buffer.from(bytes))
      .getEntry('ppt/slides/_rels/slide1.xml.rels')
      ?.getData()
      .toString('utf8')
    // slideLayout1 is the package default; anything else is the template's.
    expect(rels).toBeDefined()
    expect(rels).not.toMatch(/slideLayouts\/slideLayout1\.xml/)
    expect(rels).toMatch(/slideLayouts\/slideLayout\d+\.xml/)
  })

  /**
   * The join between the two halves of the round trip.
   *
   * The export writes a declaration onto each layout page; the importer reads
   * it back and, finding one, groups the slides by their author's own design
   * instead of clustering them afresh (`isOwnExport` in import-presentation).
   * Each half is tested on its own — this asserts they speak the same
   * language, which is the part that silently broke when a lecture exported
   * and re-imported came home rearranged.
   *
   * The conversion in between is Google's, so it is not exercised here; what
   * is exercised is that the bytes we write parse into the specs it expects.
   */
  it('writes a declaration the importer can parse back into slots', async () => {
    const xml = layoutParts(
      await deckToPptx(withLayouts, undefined, true),
    ).join('')
    // The declaration rides in an alt-text attribute, so it is XML-escaped.
    const encoded = /name="(\{&quot;slidemachine&quot;.*?)"/.exec(xml)?.[1]
    expect(encoded).toBeDefined()
    const json = encoded!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')

    const slots = parseSlotMetadata(json)
    expect(slots).toEqual([{ name: 'title', kind: 'text', label: 'Title' }])
  })

  /**
   * A layout's placeholder shows its own label until someone types in it,
   * which is right on a layout and wrong on a lecture: a slide with no picture
   * would arrive showing the word "Diagram" where the picture should be.
   */
  it("does not leave a layout's prompt showing on a slide that skipped the box", async () => {
    const twoSlots: ExportDeck = {
      ...withLayouts,
      layouts: [
        {
          type: 'title',
          label: 'Title',
          purpose: 'Opening slide',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'diagram', kind: 'image', label: 'Diagram' },
          ],
          elementPositions: {
            title: { x: 0.08, y: 0.1, w: 0.84, h: 0.2 },
            diagram: { x: 0.08, y: 0.4, w: 0.84, h: 0.4 },
          },
        },
      ] as Layout[],
      // Titled, but with no picture for the box the layout reserves.
      slides: [
        {
          layoutType: 'title',
          title: 'Photosynthesis',
          slots: { title: { kind: 'text', value: 'Photosynthesis' } },
        },
      ],
    }
    const bytes = await deckToPptx(twoSlots, undefined, true)
    const slideXml = new AdmZip(Buffer.from(bytes))
      .getEntry('ppt/slides/slide1.xml')
      ?.getData()
      .toString('utf8')
    expect(slideXml).toContain('Photosynthesis')
    // The label belongs to the layout page, not to the lecture's slide.
    expect(slideXml).not.toContain('>Diagram<')
  })

  it('still exports a valid file either way', async () => {
    for (const bytes of [
      await deckToPptx(withLayouts),
      await deckToPptx(withLayouts, undefined, true),
    ]) {
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    }
  })
})
/**
 * The credit under a picture belongs to the page, not to the lecture.
 *
 * A visual export prints it because a licence has to be readable in the file
 * itself (IMG-5). Unmarked, a re-import read that line as content: the words
 * came back as a caption ON the slide, in a box the author never made, while
 * the picture's own provenance dialog stayed empty.
 */
describe('the credit printed under a picture', () => {
  const withPicture: ExportDeck = {
    title: 'Cells',
    templateId: 'classic',
    slides: [
      {
        layoutType: 'image',
        title: 'A mitochondrion',
        imageRef: 'https://pictures.test/m.png',
        attribution: {
          title: 'Mitochondrion',
          creator: 'Ada',
          sourceName: 'Wikimedia',
          license: 'CC BY-SA 4.0',
        },
      },
    ],
  }

  const withPicture2 = (caption?: string): ExportDeck => ({
    ...withPicture,
    slides: [{ ...withPicture.slides[0]!, caption }],
  })

  const shapeNames = (bytes: Uint8Array): string[] =>
    (new AdmZip(Buffer.from(bytes))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')
      .match(/name="[^"]*"/g) ?? []) as string[]

  const stubImageFetch = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      }),
    )

  it('is printed once, not twice', async () => {
    // Two renderers each drew it: the shared layout model puts a credit under
    // the picture, and this exporter drew a second one on top of it. Counted
    // in the drawn text only — the picture's alt text names the source too,
    // and that copy is the one the import reads back into the dialog.
    stubImageFetch()
    const xml = new AdmZip(Buffer.from(await deckToPptx(withPicture)))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')
    const drawn = (xml.match(/<a:t>[^<]*<\/a:t>/g) ?? []).filter(t =>
      t.includes('Wikimedia'),
    )
    expect(drawn).toHaveLength(1)
  })

  it('leaves the author’s own caption a box of its own, which does come home', async () => {
    stubImageFetch()
    const names = shapeNames(await deckToPptx(withPicture2('Figure 1: a cell')))
    // The caption is unmarked — it is the lecture's, and re-imports as
    // content. The credit beneath it is marked, and does not.
    expect(names).toContain('name="credit-line"')
    expect(names.filter(n => n === 'name="credit-line"')).toHaveLength(1)
  })

  /**
   * The credit belongs to the picture, not to one way of arranging it.
   *
   * It used to be drawn by the exporter, for every picture. Moving it into
   * the shared layout model put it only in the hand-tuned arrangements, so a
   * deck laid out by its own template — which is most of them — exported with
   * no attribution at all, and nothing here noticed: every test used a deck
   * with no template.
   */
  it('is printed for a deck arranged by its own template too', async () => {
    stubImageFetch()
    const template = [
      {
        type: 'figure',
        label: 'Figure',
        purpose: 'A picture and its title',
        slots: [
          { name: 'title', kind: 'text', label: 'Title' },
          { name: 'picture', kind: 'image', label: 'Picture' },
        ],
        elementPositions: {
          title: { x: 0.08, y: 0.08, w: 0.84, h: 0.12 },
          picture: { x: 0.2, y: 0.26, w: 0.6, h: 0.5 },
        },
      },
    ] as Layout[]
    const bytes = await deckToPptx({
      title: 'Cells',
      templateId: 'own',
      layouts: template,
      templateTheme: { background: '#ffffff', text: '#111111' },
      slides: [
        {
          layoutType: 'figure',
          title: 'A mitochondrion',
          imageRef: 'https://pictures.test/m.png',
          attribution: withPicture.slides[0]!.attribution,
          slots: {
            title: { kind: 'text', value: 'A mitochondrion' },
            picture: {
              kind: 'image',
              ref: 'https://pictures.test/m.png',
              attribution: withPicture.slides[0]!.attribution,
            },
          },
        },
      ],
    })
    const xml = new AdmZip(Buffer.from(bytes))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')
    const drawn = (xml.match(/<a:t>[^<]*<\/a:t>/g) ?? []).filter(t =>
      t.includes('Wikimedia'),
    )
    expect(drawn).toHaveLength(1)
    expect(xml).toContain('name="credit-line"')
  })

  it('is named so a re-import knows not to read it as content', async () => {
    stubImageFetch()
    const bytes = await deckToPptx(withPicture)
    const xml = new AdmZip(Buffer.from(bytes))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')
    // Printed, so a reader of the file sees whose picture it is...
    expect(xml).toContain('Wikimedia')
    // ...and marked, so an importer can tell it from the author's own words.
    expect(xml).toMatch(/name="credit-line"[^>]*descr="credit-line"/)
  })
})

describe('a slide holding more than its box', () => {
  /** The smallest type size in a slide's XML, in hundredths of a point. */
  const smallestSize = (xml: string): number =>
    Math.min(...[...xml.matchAll(/sz="(\d+)"/g)].map(m => Number(m[1])))

  const xmlFor = async (body: string) => {
    const one: ExportDeck = {
      title: 'Photosynthesis',
      templateId: 'classic',
      slides: [{ layoutType: 'content', title: 'Light', body }],
    }
    return new AdmZip(Buffer.from(await deckToPptx(one)))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')
  }

  const dense = Array.from(
    { length: 24 },
    (_, i) => `Point ${i + 1}: a full line of prose about photosynthesis.`,
  ).join('\n')

  it('draws its type smaller than a slide that fits', async () => {
    // Without this the exporter drew every line from the top of the box at the
    // size the design asks for, so the end of a dense slide ran off the box and
    // off the page: the file was a different lecture from the one on screen.
    expect(smallestSize(await xmlFor(dense))).toBeLessThan(
      smallestSize(await xmlFor('An overview')),
    )
  })

  it('leaves a slide that fits at the size its design asks for', async () => {
    // The common case, and the one to protect: a deck the app wrote is written
    // to the box's limits, and shrinking those too would be a restyling.
    expect(smallestSize(await xmlFor('An overview'))).toBe(
      smallestSize(await xmlFor('An overview of the topic')),
    )
  })

  it('asks PowerPoint to shrink the box itself as well', async () => {
    // The estimate here has no font metrics; PowerPoint does. It only
    // recomputes on an edit, which is why the type is pre-shrunk too.
    expect(await xmlFor('An overview')).toContain('normAutofit')
  })
})

/**
 * The typeface a design asked for, carried into the file (TMPL-8).
 *
 * The exporters knew only "monospaced or not", so a deck imported from a
 * design set in Georgia came back from the exporter in the one face the
 * exporter happened to use — which is the plainest way a file stops looking
 * like the deck it was made from.
 */
describe('the typeface an exported deck is set in', () => {
  /** The first slide's XML, where a run states the face it is set in. */
  const slideXml = async (deck: ExportDeck) =>
    new AdmZip(Buffer.from(await deckToPptx(deck)))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')

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

  it('sets a serif design in a serif', async () => {
    expect(await slideXml(inFont('serif'))).toContain('Georgia')
  })

  it('sets a condensed design in a condensed face', async () => {
    expect(await slideXml(inFont('condensed'))).toContain('Arial Narrow')
  })

  it('leaves a design that asked for no particular stack alone', async () => {
    // The file's own default is as good an answer, and naming a face where
    // none was chosen would be inventing a design decision.
    const xml = await slideXml(inFont())
    expect(xml).not.toContain('Georgia')
    expect(xml).not.toContain('Arial Narrow')
  })
})

/**
 * An imported slide in the .pptx (TMPL-8/EXP-5), which is what Drive converts
 * into Google Slides.
 *
 * The same three faults the PDF had: a Markdown box written out as its source,
 * every box drawn in one colour, and none of the design's own bands.
 */
describe('an imported slide in an exported deck', () => {
  const imported: Layout = {
    type: 'imported',
    label: 'Imported',
    purpose: 'a slide',
    slots: [{ name: 'body', kind: 'text', label: 'Body' }],
    elementPositions: {
      body: { x: 0.1, y: 0.2, w: 0.8, h: 0.6, color: '#0000FF' },
    },
    decoration: [{ x: 0, y: 0.95, w: 1, h: 0.02, fill: '#63D297' }],
  }

  const xmlOf = async (value: string) => {
    const deck: ExportDeck = {
      title: 'Imported',
      templateId: 'classic',
      layouts: [imported],
      slides: [
        { layoutType: 'imported', slots: { body: { kind: 'text', value } } },
      ],
    }
    return new AdmZip(Buffer.from(await deckToPptx(deck)))
      .getEntry('ppt/slides/slide1.xml')!
      .getData()
      .toString('utf8')
  }

  /** The words the slide says, with the runs joined back together. */
  const wordsIn = (xml: string) =>
    [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')

  it('writes the words, not the Markdown that spells them', async () => {
    const xml = await xmlOf('**Faculty** of parts')
    expect(wordsIn(xml)).toContain('Faculty')
    expect(wordsIn(xml)).not.toContain('**')
  })

  it('counts a numbered list instead of writing 1 every time', async () => {
    expect(wordsIn(await xmlOf('1. One\n1. Two\n1. Three'))).toContain('2.')
  })

  it('draws a box in the colour its design gives it', async () => {
    expect(await xmlOf('Plain words')).toContain('0000FF')
  })

  it('draws the design’s own band', async () => {
    expect(await xmlOf('Plain words')).toContain('63D297')
  })

  it('carries a link as a link, not as its address in the words', async () => {
    // Slides and PowerPoint both have hyperlinks; an imported slide whose only
    // address was inside one exported unreachable.
    expect(await xmlOf('See [the handbook](https://example.org/handbook)')).toContain(
      'hlinkClick',
    )
  })
})
