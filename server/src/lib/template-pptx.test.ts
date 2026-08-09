/**
 * Unit tests for exporting a style template as a .pptx (EXP-6).
 *
 * The claim worth testing is structural: the template's layouts must become
 * the presentation's own **slide layouts**, because that is what Drive
 * converts into native Google Slides layouts. A file that merely looked right
 * but had none would be a picture of a template rather than a template.
 *
 * A .pptx is a zip of XML parts, so the assertions read the parts it contains.
 * The file always carries one layout of its own — the blank one pptxgenjs
 * defines — so a template's layouts are counted on top of that.
 */
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import type { Template } from '@slide-machine/shared'
import { templateToPptx } from './template-pptx'
import { parseSlotMetadata, slotFromToken } from './slot-metadata'

/** The parts of a kind inside the generated file. A .pptx is a zip of
 * compressed XML, so the parts are read rather than the bytes scanned. */
const parts = (bytes: Uint8Array, pattern: RegExp): string[] =>
  new AdmZip(Buffer.from(bytes))
    .getEntries()
    .filter(e => !e.isDirectory && pattern.test(e.entryName))
    .map(e => e.entryName)

/** The presentation's own layouts, the built-in blank one included. */
const layouts = (bytes: Uint8Array) =>
  parts(bytes, /^ppt\/slideLayouts\/slideLayout\d+\.xml$/)
const slides = (bytes: Uint8Array) =>
  parts(bytes, /^ppt\/slides\/slide\d+\.xml$/)

/** Every layout and slide part's XML, joined — for asking whether something
 * the design states reached the file at all. */
const allXml = (bytes: Uint8Array): string => {
  const zip = new AdmZip(Buffer.from(bytes))
  return zip
    .getEntries()
    .filter(
      e =>
        !e.isDirectory &&
        /^ppt\/(slideLayouts|slides|slideMasters)\/[^/]+\.xml$/.test(
          e.entryName,
        ),
    )
    .map(e => e.getData().toString('utf8'))
    .join('')
}

const layout = (
  type: string,
  slots: { name: string; kind?: 'text' | 'bullets' | 'image' }[],
) => ({
  type,
  label: type,
  purpose: `use for ${type}`,
  slots: slots.map(s => ({
    name: s.name,
    kind: s.kind ?? ('text' as const),
    label: s.name,
  })),
  elementPositions: Object.fromEntries(
    slots.map((s, i) => [
      s.name,
      { x: 0.06, y: 0.06 + i * 0.3, w: 0.88, h: 0.25 },
    ]),
  ),
})

/** The picture files inside the presentation, the media folder entry itself
 * excluded. */
const media = (zip: AdmZip) =>
  zip
    .getEntries()
    .filter(e => !e.isDirectory && /^ppt\/media\//.test(e.entryName))

/** A one-pixel PNG and a one-pixel GIF: real image bytes, and distinct, so a
 * test can tell one picture from another inside the file. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OTHER_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const template = (over: Partial<Template> = {}): Template =>
  ({
    id: 't1',
    ownerId: 'u1',
    name: 'Mine',
    theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
    layouts: [
      layout('title', [{ name: 'title' }]),
      layout('content', [{ name: 'title' }, { name: 'body' }]),
      layout('whiteboard', []),
    ],
    visibility: 'private',
    voteScore: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Template

describe('a template exported as a presentation', () => {
  it('is a real .pptx', async () => {
    const bytes = await templateToPptx(template())
    // Zip local-file header: what Drive needs before it will convert
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('turns each layout into a layout of the presentation', async () => {
    const bytes = await templateToPptx(template())
    // These are what Drive converts into native Slides layouts — the whole
    // mechanism by which an exported template is a template over there
    expect(layouts(bytes).length).toBe(2 + 1)
  })

  it('shows each layout on a demonstration slide', async () => {
    const bytes = await templateToPptx(template())
    // A deck of invisible placeholders would be useless to open
    expect(slides(bytes).length).toBe(2)
  })

  it('leaves the whiteboard layout out (TMPL-7)', async () => {
    const withWhiteboard = await templateToPptx(template())
    const without = await templateToPptx(
      template({
        layouts: template().layouts.filter(l => l.type !== 'whiteboard'),
      }),
    )
    // It is an app-only blank slate with no design to carry, and is
    // re-synthesized on import
    expect(layouts(withWhiteboard).length).toBe(layouts(without).length)
  })

  it('names each layout after itself, so Slides shows it', async () => {
    const bytes = await templateToPptx(
      template({ layouts: [layout('lab-safety', [{ name: 'title' }])] }),
    )
    expect(allXml(bytes)).toContain('LAB-SAFETY')
  })

  it('carries the author’s own words as each box’s prompt', async () => {
    const withLabels = template()
    withLabels.layouts[1]!.slots[1]!.label = 'Worked example'
    const bytes = await templateToPptx(withLabels)
    // A layout explains itself in Slides rather than showing "Click to add"
    expect(allXml(bytes)).toContain('Worked example')
  })

  it('still produces an openable file when nothing has geometry', async () => {
    const unplaced = {
      ...layout('content', [{ name: 'title' }]),
      elementPositions: {},
    }
    const bytes = await templateToPptx(
      template({ layouts: [unplaced] as Template['layouts'] }),
    )
    // Nothing measured is the normal case, not an error: the layout's own
    // tree says where its boxes go, and it still becomes a real layout
    expect(bytes[0]).toBe(0x50)
    expect(layouts(bytes).length).toBe(1 + 1)
  })

  it('shows each box once on the demonstration slide', async () => {
    // The bug this guards: a slide that drew its own text left the layout's
    // empty placeholder sitting behind it, so every box appeared twice, and
    // Slides showed a stack of overlapping boxes on the first slide
    const zip = new AdmZip(
      Buffer.from(
        await templateToPptx(
          template({
            layouts: [
              {
                ...layout('content', [{ name: 'title' }, { name: 'body' }]),
                elementPositions: {},
              },
            ] as Template['layouts'],
          }),
        ),
      ),
    )
    const slide = zip.readAsText('ppt/slides/slide1.xml')
    expect(slide.split('<p:sp>').length - 1).toBe(2)
  })

  it('places boxes for a layout that was never measured', async () => {
    // The regression that mattered: every built-in carries an empty
    // `elementPositions`, so an exporter reading only that produced masters
    // with nothing in them and slides that opened blank
    const unmeasured = template({
      layouts: [
        {
          ...layout('content', [{ name: 'title' }, { name: 'body' }]),
          elementPositions: {},
        },
      ] as Template['layouts'],
    })
    const xml = allXml(await templateToPptx(unmeasured))
    // EMUs: a placeholder that was placed has a non-zero extent
    expect(xml).toMatch(/<a:ext cx="[1-9]\d{4,}" cy="[1-9]\d{4,}"\/>/)
  })

  it('draws the decoration a design is partly made of', async () => {
    // The section break is an accent rule above its heading. A box-only export
    // would drop it and quietly change the design
    const bytes = await templateToPptx(
      template({
        layouts: [
          { ...layout('section', [{ name: 'title' }]), elementPositions: {} },
        ] as Template['layouts'],
      }),
    )
    expect(allXml(bytes)).toContain('0055FF')
  })

  it('sets a title at title size rather than body size', async () => {
    const bytes = await templateToPptx(
      template({
        layouts: [
          { ...layout('title', [{ name: 'title' }]), elementPositions: {} },
        ] as Template['layouts'],
      }),
    )
    // 7cqi of a 10in slide is 50.4pt, and pptx counts in hundredths
    expect(allXml(bytes)).toContain('sz="5040"')
  })

  it('puts a picture in a picture box when it has one', async () => {
    const withImage = template({
      layouts: [
        layout('two-column', [
          { name: 'title' },
          { name: 'image', kind: 'image' },
        ]),
      ] as Template['layouts'],
    })
    const zip = new AdmZip(
      Buffer.from(await templateToPptx(withImage, [PIXEL])),
    )
    // The picture reaches the file, and the box is still the layout's box
    expect(media(zip).length).toBe(1)
    const slide = zip.readAsText('ppt/slides/slide1.xml')
    expect(slide).toContain('<p:pic>')
    expect(slide.split('<p:sp>').length - 1).toBe(1)
  })

  it('takes a different picture for each box', async () => {
    const two = template({
      layouts: [
        layout('gallery', [
          { name: 'left', kind: 'image' },
          { name: 'right', kind: 'image' },
        ]),
      ] as Template['layouts'],
    })
    const zip = new AdmZip(
      Buffer.from(await templateToPptx(two, [PIXEL, OTHER_PIXEL])),
    )
    // A design with several picture boxes showing one picture twice would
    // misrepresent it
    expect(media(zip).length).toBe(2)
  })

  it('shows a picture box as reserved space when there is no picture', async () => {
    const withImage = template({
      layouts: [
        layout('image-heavy', [{ name: 'image', kind: 'image' }]),
      ] as Template['layouts'],
    })
    // An image host that is blocked or offline costs the export its
    // illustrations, never the export
    const bytes = await templateToPptx(withImage, [])
    expect(bytes[0]).toBe(0x50)
    expect(slides(bytes).length).toBe(1)
  })

  it('keeps pictures off the layouts themselves', async () => {
    const withImage = template({
      layouts: [
        layout('image-heavy', [{ name: 'image', kind: 'image' }]),
      ] as Template['layouts'],
    })
    const zip = new AdmZip(
      Buffer.from(await templateToPptx(withImage, [PIXEL])),
    )
    // A layout carrying a photograph would bake it into every slide made from
    // it — a design nobody chose
    expect(zip.readAsText('ppt/slideLayouts/slideLayout2.xml')).not.toContain(
      '<p:pic>',
    )
  })

  it('produces a valid presentation for a whiteboard-only template', async () => {
    const bytes = await templateToPptx(
      template({
        layouts: template().layouts.filter(l => l.type === 'whiteboard'),
      }),
    )
    // Nothing to export, but Drive refuses to convert an empty file
    expect(bytes[0]).toBe(0x50)
    expect(slides(bytes).length).toBe(1)
  })
})

describe('what an exported design says about itself (EXP-8)', () => {
  /** Every shape description in a part — which is where a slot's identity and
   * a layout's payload both end up. */
  const descriptions = (bytes: Uint8Array, name: string): string[] => {
    const xml = new AdmZip(Buffer.from(bytes)).readAsText(name)
    return [...xml.matchAll(/descr="([^"]*)"/g)].map(m =>
      m[1]!
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    )
  }

  // A layout its author named and composed themselves (TMPL-9), so both of
  // its boxes are its own rather than borrowed from a conventional type.
  const authored = () =>
    template({
      layouts: [
        {
          ...layout('worked-problem', [{ name: 'title' }, { name: 'example' }]),
          slots: [
            { name: 'title', kind: 'text' as const, label: 'Title' },
            {
              name: 'example',
              kind: 'text' as const,
              label: 'Worked example',
              description: 'A runnable Python snippet, no more than 8 lines.',
              maxWords: 40,
              required: true,
            },
          ],
        },
      ] as Template['layouts'],
    })

  it('says which slot each shape is, on the layout', async () => {
    const bytes = await templateToPptx(authored())
    const found = descriptions(bytes, 'ppt/slideLayouts/slideLayout2.xml')
      .map(slotFromToken)
      .filter(Boolean)
    // A layout carrying this is what lets a TEMPLATE round-trip, not just a
    // deck — a slide's notes have no equivalent, since layouts have none
    expect(found).toEqual(['title', 'example'])
  })

  it('says it on the demonstration slide too', async () => {
    const bytes = await templateToPptx(authored())
    const found = descriptions(bytes, 'ppt/slides/slide1.xml')
      .map(slotFromToken)
      .filter(Boolean)
    expect(found).toEqual(['title', 'example'])
  })

  it('carries each slot’s kind, instruction and limits beside it', async () => {
    const bytes = await templateToPptx(authored())
    const payload = descriptions(bytes, 'ppt/slideLayouts/slideLayout2.xml')
      .map(parseSlotMetadata)
      .find(Boolean)
    // The whole claim of EXP-8: what a box IS comes back, rather than being
    // guessed from the rectangle it happened to occupy
    expect(payload).toEqual([
      { name: 'title', kind: 'text', label: 'Title' },
      {
        name: 'example',
        kind: 'text',
        label: 'Worked example',
        description: 'A runnable Python snippet, no more than 8 lines.',
        maxWords: 40,
        required: true,
      },
    ])
  })

  it('keeps the payload off the canvas', async () => {
    const bytes = await templateToPptx(authored())
    const xml = new AdmZip(Buffer.from(bytes)).readAsText(
      'ppt/slideLayouts/slideLayout2.xml',
    )
    // 10 inches is the slide's width in EMUs; the marker sits past it, so it
    // is carried by the file and drawn over nothing
    const offsets = [...xml.matchAll(/<a:off x="(-?\d+)"/g)].map(m =>
      Number(m[1]),
    )
    expect(Math.max(...offsets)).toBeGreaterThan(10 * 914400)
  })
})
