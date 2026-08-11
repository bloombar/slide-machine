/**
 * Unit tests for reading a Google Slides presentation (TMPL-8, stage 1).
 *
 * This is the only stage that knows what an EMU is, so the tests are mostly
 * about arithmetic and vocabulary: a shape's size and transform become a box
 * as a fraction of the page, a theme colour name becomes a literal, and a
 * point size becomes the `cqi` the template model measures type in.
 *
 * The fixtures are shaped the way Google's responses are, nesting and all —
 * a simplified fixture would test a reader we do not have.
 */
import { describe, it, expect } from 'vitest'
import { toSourcePresentation } from './read-slides'
import { slotToken, encodeSlotMetadata } from '../lib/slot-metadata'

const EMU = 914400
const PAGE = { width: 10 * EMU, height: 5.625 * EMU }

const dim = (emu: number) => ({ magnitude: emu, unit: 'EMU' })

/** A shape, as Google gives one: its own size, scaled and moved into place. */
const shape = (
  over: Record<string, unknown> = {},
  box = { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
) => ({
  objectId: 'shape-1',
  size: { width: dim(box.w * PAGE.width), height: dim(box.h * PAGE.height) },
  transform: {
    scaleX: 1,
    scaleY: 1,
    translateX: dim(box.x * PAGE.width),
    translateY: dim(box.y * PAGE.height),
  },
  ...over,
})

const textShape = (text: string, style: Record<string, unknown> = {}) =>
  shape({
    shape: {
      shapeType: 'TEXT_BOX',
      placeholder: { type: 'TITLE' },
      text: {
        textElements: [
          { paragraphMarker: {} },
          { textRun: { content: `${text}\n`, style } },
        ],
      },
    },
  })

const presentation = (over: Record<string, unknown> = {}) => ({
  presentationId: 'p1',
  title: 'Rainwater',
  pageSize: { width: dim(PAGE.width), height: dim(PAGE.height) },
  masters: [
    {
      pageProperties: {
        colorScheme: {
          colors: [
            { type: 'DARK1', color: { red: 0, green: 0, blue: 0 } },
            { type: 'LIGHT1', color: { red: 1, green: 1, blue: 1 } },
            { type: 'ACCENT1', color: { red: 0, green: 0.4, blue: 1 } },
          ],
        },
      },
    },
  ],
  layouts: [],
  slides: [],
  ...over,
})

describe('where a shape sits', () => {
  it('is a fraction of the page, from the top-left', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [textShape('Hi')] }],
      }),
    )
    expect(read.slides[0]!.elements[0]!.box).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.25,
    })
  })

  it('accounts for the transform’s scale, not just its offset', () => {
    // Google gives a shape's own size and an affine transform; the box you
    // actually see is the two multiplied
    const scaled = shape({
      shape: {
        shapeType: 'TEXT_BOX',
        placeholder: { type: 'BODY' },
        text: { textElements: [{ textRun: { content: 'x\n', style: {} } }] },
      },
    })
    scaled.transform.scaleX = 2
    scaled.transform.scaleY = 2
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [scaled] }] }),
    )
    expect(read.slides[0]!.elements[0]!.box.w).toBeCloseTo(1, 5)
  })

  it('never runs off the page', () => {
    const off = shape(
      {
        shape: {
          shapeType: 'TEXT_BOX',
          placeholder: { type: 'BODY' },
          text: { textElements: [{ textRun: { content: 'x\n', style: {} } }] },
        },
      },
      { x: 0.9, y: 0.9, w: 0.9, h: 0.9 },
    )
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [off] }] }),
    )
    const box = read.slides[0]!.elements[0]!.box
    expect(box.x).toBeLessThanOrEqual(1)
    expect(box.w).toBeLessThanOrEqual(1)
  })
})

describe('how a shape is styled', () => {
  it('resolves a theme colour name to the literal it stands for', () => {
    // `ACCENT1` means nothing once the design leaves the presentation
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              textShape('Hi', {
                foregroundColor: { opaqueColor: { themeColor: 'ACCENT1' } },
              }),
            ],
          },
        ],
      }),
    )
    expect(read.slides[0]!.elements[0]!.runs?.[0]?.color).toBe('#0066ff')
  })

  it('measures type as a percent of the page width', () => {
    // Which is the `cqi` the template model states type in: 36pt on a
    // ten-inch page is half an inch, or 5% of the width
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              textShape('Hi', { fontSize: { magnitude: 36, unit: 'PT' } }),
            ],
          },
        ],
      }),
    )
    expect(read.slides[0]!.elements[0]!.runs?.[0]?.fontSize).toBeCloseTo(5, 1)
  })

  it('keeps the placeholder type, which is what a hand-built deck offers', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [textShape('Hi')] }],
      }),
    )
    expect(read.slides[0]!.elements[0]!.placeholder).toBe('TITLE')
  })

  it('notices a list', () => {
    const bulleted = shape({
      shape: {
        shapeType: 'TEXT_BOX',
        placeholder: { type: 'BODY' },
        text: {
          textElements: [
            { paragraphMarker: { bullet: {} } },
            { textRun: { content: 'One\n', style: {} } },
          ],
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [bulleted] }] }),
    )
    expect(read.slides[0]!.elements[0]!.bulleted).toBe(true)
  })
})

describe('what a shape turns out to be', () => {
  it('reads a picture and where to fetch it', () => {
    const picture = shape({ image: { contentUrl: 'https://x/y.png' } })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [picture] }] }),
    )
    expect(read.slides[0]!.elements[0]).toMatchObject({
      kind: 'image',
      imageUrl: 'https://x/y.png',
    })
  })

  it('reads a table as rows and columns', () => {
    const cell = (text: string) => ({
      text: {
        textElements: [{ textRun: { content: `${text}\n`, style: {} } }],
      },
    })
    const table = shape({
      table: {
        tableRows: [
          { tableCells: [cell('Year'), cell('mm')] },
          { tableCells: [cell('2024'), cell('812')] },
        ],
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [table] }] }),
    )
    expect(read.slides[0]!.elements[0]).toMatchObject({
      kind: 'table',
      table: {
        rows: [
          ['Year', 'mm'],
          ['2024', '812'],
        ],
      },
    })
  })

  it('keeps a rule, which is part of a design though it holds nothing', () => {
    const rule = shape({
      shape: {
        shapeType: 'RECTANGLE',
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: { color: { themeColor: 'ACCENT1' } },
          },
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [rule] }] }),
    )
    expect(read.slides[0]!.elements[0]).toMatchObject({
      kind: 'decoration',
      fill: '#0066ff',
    })
  })

  it('drops a shape that holds nothing and paints nothing', () => {
    const empty = shape({ shape: { shapeType: 'TEXT_BOX', text: {} } })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [empty] }] }),
    )
    expect(read.slides[0]!.elements).toHaveLength(0)
  })
})

describe('a presentation this system exported (EXP-8)', () => {
  it('reads a box’s own name off its alt text', () => {
    const tagged = shape({
      description: slotToken('worked-example'),
      shape: {
        shapeType: 'TEXT_BOX',
        text: { textElements: [{ textRun: { content: 'x\n', style: {} } }] },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [tagged] }] }),
    )
    // Worth more than every inference the later stages make
    expect(read.slides[0]!.elements[0]!.slotName).toBe('worked-example')
  })

  it('reads the slot metadata a layout carries', () => {
    const payload = encodeSlotMetadata([
      { name: 'title', kind: 'text', label: 'Title' },
      { name: 'eq', kind: 'math', label: 'Equation' },
    ])!
    const marker = shape({
      description: payload,
      shape: { shapeType: 'TEXT_BOX', text: { textElements: [] } },
    })
    const read = toSourcePresentation(
      presentation({
        layouts: [
          {
            objectId: 'l1',
            layoutProperties: { displayName: 'CONTENT' },
            pageElements: [marker],
          },
        ],
      }),
    )
    expect(read.layouts[0]!.slotMetadata).toHaveLength(2)
    expect(read.layouts[0]!.name).toBe('CONTENT')
  })

  it('reads the narration out of the speaker notes', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [],
            slideProperties: {
              layoutObjectId: 'l1',
              notesPage: {
                pageElements: [
                  {
                    objectId: 'n1',
                    shape: {
                      placeholder: { type: 'BODY' },
                      text: {
                        textElements: [
                          { textRun: { content: 'What I said.\n', style: {} } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      }),
    )
    expect(read.slides[0]!.notes).toBe('What I said.')
    expect(read.slides[0]!.layoutId).toBe('l1')
  })
})

describe('a presentation that states little', () => {
  it('still reads, with a default page and a sane palette', () => {
    const read = toSourcePresentation({ presentationId: 'p', slides: [] })
    expect(read.title).toBe('Imported design')
    expect(read.theme.background).toBe('#ffffff')
    expect(read.theme.text).toBe('#1c2230')
  })

  it('takes its background from the first slide, which is what is seen', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [],
            pageProperties: {
              pageBackgroundFill: {
                solidFill: {
                  color: { rgbColor: { red: 0, green: 0, blue: 0.2 } },
                },
              },
            },
          },
        ],
      }),
    )
    expect(read.theme.background).toBe('#000033')
  })
})
