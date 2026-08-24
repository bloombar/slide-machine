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
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  toSourcePresentation,
  readPresentationLive,
  PresentationUnreadableError,
} from './read-slides'
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

  it('reads how a table divides itself, so it is not re-divided equally', () => {
    // Google states a width for every column. Discarding them and drawing
    // equal columns gives a year the same width as a sentence, which is one of
    // the plainest ways an imported table stops looking like its slide.
    const cell = (text: string) => ({
      text: {
        textElements: [{ textRun: { content: `${text}\n`, style: {} } }],
      },
    })
    const table = shape({
      table: {
        tableColumns: [
          { columnWidth: { magnitude: 1_000_000, unit: 'EMU' } },
          { columnWidth: { magnitude: 3_000_000, unit: 'EMU' } },
        ],
        tableRows: [
          {
            rowHeight: { magnitude: 500_000, unit: 'EMU' },
            tableCells: [cell('Year'), cell('mm')],
          },
          {
            rowHeight: { magnitude: 1_500_000, unit: 'EMU' },
            tableCells: [cell('2024'), cell('812')],
          },
        ],
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [table] }] }),
    )
    // Fractions of the table, not lengths: the box is the box the reader
    // measured, and what matters is the proportions inside it.
    expect(read.slides[0]!.elements[0]).toMatchObject({
      kind: 'table',
      table: { colWidths: [0.25, 0.75], rowHeights: [0.25, 0.75] },
    })
  })

  it('leaves a table whose columns state no width to divide itself equally', () => {
    const cell = (text: string) => ({
      text: {
        textElements: [{ textRun: { content: `${text}\n`, style: {} } }],
      },
    })
    const table = shape({
      table: { tableRows: [{ tableCells: [cell('a'), cell('b')] }] },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [table] }] }),
    )
    const element = read.slides[0]!.elements[0]!
    expect(element.table?.colWidths).toBeUndefined()
    expect(element.table?.rowHeights).toBeUndefined()
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

  it('keeps the breaks between what was said in several paragraphs', () => {
    // Run together, two paragraphs of narration became one sentence with no
    // gap — "the first part.And then" — which is what the presenter then
    // heard read back to them.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [],
            slideProperties: {
              notesPage: {
                pageElements: [
                  {
                    objectId: 'n1',
                    shape: {
                      placeholder: { type: 'BODY' },
                      text: {
                        textElements: [
                          { paragraphMarker: {} },
                          {
                            textRun: {
                              content: 'The first part.\n',
                              style: {},
                            },
                          },
                          { paragraphMarker: {} },
                          {
                            textRun: {
                              content: 'And then the rest.\n',
                              style: {},
                            },
                          },
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
    expect(read.slides[0]!.notes).toBe('The first part.\nAnd then the rest.')
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

describe('how the text sits in its box', () => {
  it('keeps a centred paragraph centred', () => {
    // A centred title read as left-aligned is the most visible way an import
    // stops looking like the deck it came from
    const centred = shape({
      shape: {
        shapeType: 'TEXT_BOX',
        placeholder: { type: 'TITLE' },
        shapeProperties: { contentAlignment: 'MIDDLE' },
        text: {
          textElements: [
            { paragraphMarker: { style: { alignment: 'CENTER' } } },
            { textRun: { content: 'Hi\n', style: {} } },
          ],
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [centred] }] }),
    )
    expect(read.slides[0]!.elements[0]).toMatchObject({
      align: 'center',
      vAlign: 'center',
    })
  })

  it('says nothing when the presentation states nothing', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [textShape('Hi')] }],
      }),
    )
    expect(read.slides[0]!.elements[0]!.align).toBeUndefined()
    expect(read.slides[0]!.elements[0]!.vAlign).toBeUndefined()
  })

  it('reads justified text as start, which is what the renderer offers', () => {
    const justified = shape({
      shape: {
        shapeType: 'TEXT_BOX',
        text: {
          textElements: [
            { paragraphMarker: { style: { alignment: 'JUSTIFIED' } } },
            { textRun: { content: 'Hi\n', style: {} } },
          ],
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [justified] }] }),
    )
    expect(read.slides[0]!.elements[0]!.align).toBe('start')
  })
})

/**
 * A presentation states a property once and lets everything below it go
 * unset: a slide's title placeholder usually carries no size, no type size
 * and no colour of its own. Read without following slide → layout → master,
 * a real Google deck arrives with its boxes in the corner and its colours
 * gone — which is what it did.
 */
describe('what a slide inherits from its layout and master', () => {
  const pt = (magnitude: number) => ({ magnitude, unit: 'PT' })

  /** A shape that states its own geometry, the way a layout's does. */
  const placed = (
    objectId: string,
    over: Record<string, unknown>,
    box = { x: 0.08, y: 0.12, w: 0.84, h: 0.3 },
  ) => ({
    objectId,
    size: { width: dim(box.w * PAGE.width), height: dim(box.h * PAGE.height) },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: dim(box.x * PAGE.width),
      translateY: dim(box.y * PAGE.height),
    },
    ...over,
  })

  /** A slide's placeholder: text and a pointer, and nothing else. Google
   * really does return them this bare. */
  const inheriting = (
    objectId: string,
    parentObjectId: string,
    text: string,
    style: Record<string, unknown> = {},
  ) => ({
    objectId,
    shape: {
      shapeType: 'TEXT_BOX',
      placeholder: { type: 'TITLE', parentObjectId },
      text: {
        textElements: [
          { paragraphMarker: {} },
          { textRun: { content: `${text}\n`, style } },
        ],
      },
    },
  })

  /** A deck built the ordinary way: master holds the design, layout refines
   * it, slides hold only words. */
  const deck = (over: {
    master?: Record<string, unknown>
    layout?: Record<string, unknown>
    slide?: Record<string, unknown>
  }) => ({
    presentationId: 'p1',
    title: 'Rainwater',
    pageSize: { width: dim(PAGE.width), height: dim(PAGE.height) },
    masters: [
      {
        objectId: 'master-1',
        pageProperties: {
          colorScheme: {
            colors: [
              { type: 'DARK1', color: { red: 1, green: 1, blue: 1 } },
              { type: 'LIGHT1', color: { red: 1, green: 1, blue: 1 } },
            ],
          },
        },
        pageElements: [],
        ...over.master,
      },
    ],
    layouts: [
      {
        objectId: 'layout-1',
        layoutProperties: {
          displayName: 'TITLE_AND_BODY',
          masterObjectId: 'master-1',
        },
        pageElements: [],
        ...over.layout,
      },
    ],
    slides: [
      {
        objectId: 's1',
        slideProperties: { layoutObjectId: 'layout-1' },
        pageElements: [],
        ...over.slide,
      },
    ],
  })

  const firstElement = (raw: Record<string, unknown>) =>
    toSourcePresentation(raw).slides[0]!.elements[0]!

  it('takes its box from the layout’s placeholder when it states none', () => {
    // The bug in one line: a placeholder with no geometry is not a shape at
    // the origin with no width
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: { shapeType: 'TEXT_BOX', placeholder: { type: 'TITLE' } },
            }),
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    expect(element.box).toEqual({ x: 0.08, y: 0.12, w: 0.84, h: 0.3 })
  })

  it('reaches the master when the layout states none either', () => {
    const element = firstElement(
      deck({
        master: {
          pageElements: [
            placed(
              'master-title',
              {
                shape: {
                  shapeType: 'TEXT_BOX',
                  placeholder: { type: 'TITLE' },
                },
              },
              { x: 0.05, y: 0.05, w: 0.9, h: 0.2 },
            ),
          ],
        },
        layout: {
          pageElements: [
            {
              objectId: 'layout-title',
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE', parentObjectId: 'master-title' },
              },
            },
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    expect(element.box).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.2 })
  })

  it('keeps its own box when it moved the shape', () => {
    // Inheritance is a fallback, not an override: a slide that repositioned
    // its title means it
    const moved = placed(
      'slide-title',
      {
        shape: {
          shapeType: 'TEXT_BOX',
          placeholder: { type: 'TITLE', parentObjectId: 'layout-title' },
          text: { textElements: [{ textRun: { content: 'Runoff\n' } }] },
        },
      },
      { x: 0.5, y: 0.5, w: 0.4, h: 0.1 },
    )
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: { shapeType: 'TEXT_BOX', placeholder: { type: 'TITLE' } },
            }),
          ],
        },
        slide: { pageElements: [moved] },
      }),
    )
    expect(element.box).toEqual({ x: 0.5, y: 0.5, w: 0.4, h: 0.1 })
  })

  it('takes its type size, colour and family from the layout', () => {
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE' },
                text: {
                  textElements: [
                    {
                      textRun: {
                        content: 'Click to edit Master title style\n',
                        style: {
                          fontSize: pt(36),
                          bold: true,
                          fontFamily: 'Georgia',
                          foregroundColor: {
                            opaqueColor: { themeColor: 'DARK1' },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            }),
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    // 36pt across a ten-inch page is 5% of its width
    expect(element.runs?.[0]).toMatchObject({
      text: 'Runoff',
      fontSize: 5,
      bold: true,
      fontFamily: 'Georgia',
      color: '#ffffff',
    })
  })

  it('does not inherit the layout’s prompt text as content', () => {
    // "Click to edit Master title style" is Google talking to the author, not
    // something that belongs on a lecture slide
    const read = toSourcePresentation(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE' },
                text: {
                  textElements: [
                    {
                      textRun: {
                        content: 'Click to edit Master title style\n',
                        style: { fontSize: pt(36) },
                      },
                    },
                  ],
                },
              },
            }),
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    const texts = read.slides[0]!.elements.flatMap(
      el => el.runs?.map(r => r.text) ?? [],
    )
    expect(texts).toEqual(['Runoff'])
  })

  it('lets the run’s own type size win over the inherited one', () => {
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE' },
                text: {
                  textElements: [
                    {
                      textRun: { content: 'x\n', style: { fontSize: pt(36) } },
                    },
                  ],
                },
              },
            }),
          ],
        },
        slide: {
          pageElements: [
            inheriting('slide-title', 'layout-title', 'Runoff', {
              fontSize: pt(18),
            }),
          ],
        },
      }),
    )
    expect(element.runs?.[0]?.fontSize).toBe(2.5)
  })

  it('does not inherit bold onto a run that says it is not bold', () => {
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE' },
                text: {
                  textElements: [
                    { textRun: { content: 'x\n', style: { bold: true } } },
                  ],
                },
              },
            }),
          ],
        },
        slide: {
          pageElements: [
            inheriting('slide-title', 'layout-title', 'Runoff', {
              bold: false,
            }),
          ],
        },
      }),
    )
    expect(element.runs?.[0]?.bold).toBeUndefined()
  })

  it('takes the layout’s alignment, which the slide never restates', () => {
    // A centred title read as left-aligned is the most visible way an import
    // stops looking like the deck it came from
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE' },
                shapeProperties: { contentAlignment: 'MIDDLE' },
                text: {
                  textElements: [
                    { paragraphMarker: { style: { alignment: 'CENTER' } } },
                  ],
                },
              },
            }),
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    expect(element.align).toBe('center')
    expect(element.vAlign).toBe('center')
  })

  it('takes the layout’s leading too, and keeps its alignment', () => {
    // Leading is read off the same paragraph chain alignment is, so the two
    // are pinned together: a design sets both on its layout page and no slide
    // built from it restates either. `lineSpacing` is a percentage of normal,
    // so 85 is not 0.85 — the conversion is `lineHeightFrom`.
    const element = firstElement(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                placeholder: { type: 'TITLE' },
                text: {
                  textElements: [
                    {
                      paragraphMarker: {
                        style: { alignment: 'CENTER', lineSpacing: 85 },
                      },
                    },
                  ],
                },
              },
            }),
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    expect(element.lineHeight).toBe(1.017)
    expect(element.align).toBe('center')
  })

  it('leaves the leading unset where the deck states none', () => {
    // Absent is not 1.0: a box whose deck says nothing must fall through to
    // the estimate's own fallback rather than being led at Google's normal.
    const element = firstElement(
      deck({
        slide: {
          pageElements: [
            placed('t', {
              shape: {
                shapeType: 'TEXT_BOX',
                text: {
                  textElements: [
                    { textRun: { content: 'Runoff\n', style: {} } },
                  ],
                },
              },
            }),
          ],
        },
      }),
    )
    expect(element.lineHeight).toBeUndefined()
  })

  it('survives a presentation whose placeholders point in a circle', () => {
    // A malformed file must not hang an import
    const read = toSourcePresentation(
      deck({
        layout: {
          pageElements: [
            placed('layout-title', {
              shape: {
                shapeType: 'TEXT_BOX',
                // Points back at the slide that points at it
                placeholder: { type: 'TITLE', parentObjectId: 'slide-title' },
              },
            }),
          ],
        },
        slide: {
          pageElements: [inheriting('slide-title', 'layout-title', 'Runoff')],
        },
      }),
    )
    expect(read.slides[0]!.elements[0]!.runs?.[0]?.text).toBe('Runoff')
  })

  it('drops a placeholder nothing in the chain gives a place on the page', () => {
    // An empty box the author never sized. Kept, every one of them lands at
    // the origin with no area — and their editor hints print on top of each
    // other in the corner, which is what an imported deck actually showed.
    const bare = (objectId: string, type: string) => ({
      objectId,
      shape: { shapeType: 'TEXT_BOX', placeholder: { type } },
    })
    const read = toSourcePresentation(
      deck({
        slide: {
          pageElements: [
            bare('empty-title', 'TITLE'),
            bare('empty-body', 'BODY'),
          ],
        },
      }),
    )
    expect(read.slides[0]!.elements).toEqual([])
  })

  it('keeps a placeholder that is empty but does have a place', () => {
    // An empty box IS part of a design when the design says where it goes —
    // that is how a derived layout learns the box exists at all
    const read = toSourcePresentation(
      deck({
        slide: {
          pageElements: [
            placed('sized-but-empty', {
              shape: { shapeType: 'TEXT_BOX', placeholder: { type: 'BODY' } },
            }),
          ],
        },
      }),
    )
    expect(read.slides[0]!.elements).toHaveLength(1)
    expect(read.slides[0]!.elements[0]!.placeholder).toBe('BODY')
  })
})

describe('the colour a deck is painted in', () => {
  const solidFill = (red: number, green: number, blue: number) => ({
    solidFill: { color: { rgbColor: { red, green, blue } } },
  })

  const backgroundDeck = (
    master: Record<string, unknown> | undefined,
    layout: Record<string, unknown> | undefined,
    slide: Record<string, unknown> | undefined,
  ) => ({
    presentationId: 'p1',
    title: 'Rainwater',
    pageSize: { width: dim(PAGE.width), height: dim(PAGE.height) },
    masters: [
      {
        objectId: 'master-1',
        pageProperties: {
          colorScheme: {
            colors: [{ type: 'LIGHT1', color: { red: 1, green: 1, blue: 1 } }],
          },
          ...(master ? { pageBackgroundFill: master } : {}),
        },
        pageElements: [],
      },
    ],
    layouts: [
      {
        objectId: 'layout-1',
        layoutProperties: { masterObjectId: 'master-1' },
        pageProperties: layout ? { pageBackgroundFill: layout } : {},
        pageElements: [],
      },
    ],
    slides: [
      {
        objectId: 's1',
        slideProperties: { layoutObjectId: 'layout-1' },
        pageProperties: slide ? { pageBackgroundFill: slide } : {},
        pageElements: [],
      },
    ],
  })

  it('comes from the master when nothing below it states one', () => {
    // The reported bug: a deck built in deep blue imported white
    const read = toSourcePresentation(
      backgroundDeck(
        { propertyState: 'RENDERED', ...solidFill(0.05, 0.1, 0.4) },
        undefined,
        undefined,
      ),
    )
    expect(read.slides[0]!.background).toBe('#0d1a66')
    // And the design's own palette follows it, not LIGHT1
    expect(read.theme.background).toBe('#0d1a66')
  })

  it('comes from the layout, which outranks the master', () => {
    const read = toSourcePresentation(
      backgroundDeck(
        { propertyState: 'RENDERED', ...solidFill(0, 0, 0) },
        { propertyState: 'RENDERED', ...solidFill(1, 0, 0) },
        undefined,
      ),
    )
    expect(read.slides[0]!.background).toBe('#ff0000')
  })

  it('keeps a slide’s own background over anything above it', () => {
    const read = toSourcePresentation(
      backgroundDeck(
        { propertyState: 'RENDERED', ...solidFill(0, 0, 0) },
        undefined,
        { propertyState: 'RENDERED', ...solidFill(0, 1, 0) },
      ),
    )
    expect(read.slides[0]!.background).toBe('#00ff00')
  })

  it('walks past an INHERIT marker rather than stopping at it', () => {
    // Google states the marker and often no colour beside it; either way the
    // answer is further up
    const read = toSourcePresentation(
      backgroundDeck(
        { propertyState: 'RENDERED', ...solidFill(0.05, 0.1, 0.4) },
        { propertyState: 'INHERIT' },
        { propertyState: 'INHERIT' },
      ),
    )
    expect(read.slides[0]!.background).toBe('#0d1a66')
  })

  it('walks past a fill that renders nothing, which shows the parent through', () => {
    const read = toSourcePresentation(
      backgroundDeck(
        { propertyState: 'RENDERED', ...solidFill(0.05, 0.1, 0.4) },
        { propertyState: 'NOT_RENDERED' },
        undefined,
      ),
    )
    expect(read.slides[0]!.background).toBe('#0d1a66')
  })

  it('takes a resolved colour beside an INHERIT marker over defaulting to white', () => {
    // Nothing in the chain claims one outright, but a colour did come back
    const read = toSourcePresentation(
      backgroundDeck(undefined, undefined, {
        propertyState: 'INHERIT',
        ...solidFill(0.05, 0.1, 0.4),
      }),
    )
    expect(read.slides[0]!.background).toBe('#0d1a66')
  })

  it('inherits a background picture the same way', () => {
    const read = toSourcePresentation(
      backgroundDeck(
        {
          propertyState: 'RENDERED',
          stretchedPictureFill: { contentUrl: 'https://example.test/bg.png' },
        },
        undefined,
        undefined,
      ),
    )
    expect(read.slides[0]!.backgroundImage).toBe('https://example.test/bg.png')
  })
})

/**
 * A presentation's colour scheme says what `DARK1` stands for. It does not say
 * the deck writes in it — a deck on a dark background writes in `LIGHT1`, and
 * taking `DARK1` gave near-black text on near-black. So the palette is read
 * from the deck, and every colour is checked against the background before it
 * is kept.
 */
describe('the palette a design is drawn in', () => {
  const dim = (emu: number) => ({ magnitude: emu, unit: 'EMU' })
  const PAGE_W = 10 * 914400

  const paletteDeck = (
    scheme: [string, [number, number, number]][],
    background: [number, number, number] | undefined,
    runColor: Record<string, unknown> | undefined,
    words = 'A long line of body copy on the slide',
  ) => ({
    presentationId: 'p1',
    title: 'Palette',
    pageSize: { width: dim(PAGE_W), height: dim(5.625 * 914400) },
    masters: [
      {
        objectId: 'master-1',
        pageProperties: {
          colorScheme: {
            colors: scheme.map(([type, [red, green, blue]]) => ({
              type,
              color: { red, green, blue },
            })),
          },
          ...(background
            ? {
                pageBackgroundFill: {
                  propertyState: 'RENDERED',
                  solidFill: {
                    color: {
                      rgbColor: {
                        red: background[0],
                        green: background[1],
                        blue: background[2],
                      },
                    },
                  },
                },
              }
            : {}),
        },
        pageElements: [],
      },
    ],
    layouts: [],
    slides: [
      {
        objectId: 's1',
        slideProperties: {
          layoutObjectId: 'missing',
          masterObjectId: 'master-1',
        },
        pageElements: [
          {
            objectId: 's1-body',
            size: {
              width: dim(0.8 * PAGE_W),
              height: dim(0.3 * 5.625 * 914400),
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: dim(0.1 * PAGE_W),
              translateY: dim(0.3 * 5.625 * 914400),
            },
            shape: {
              shapeType: 'TEXT_BOX',
              placeholder: { type: 'BODY' },
              text: {
                textElements: [
                  {
                    textRun: {
                      content: `${words}\n`,
                      style: runColor ? { foregroundColor: runColor } : {},
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  })

  const DARK_SCHEME: [string, [number, number, number]][] = [
    ['DARK1', [0.11, 0.13, 0.19]],
    ['LIGHT1', [1, 1, 1]],
    ['DARK2', [0.24, 0.29, 0.4]],
    ['ACCENT1', [1, 0.8, 0]],
  ]

  it('writes in the colour the deck writes in, not the one DARK1 names', () => {
    // The bug in one line: a blue deck's words are white, and the scheme's
    // DARK1 is near-black
    const read = toSourcePresentation(
      paletteDeck(DARK_SCHEME, [0.05, 0.1, 0.4], {
        opaqueColor: { themeColor: 'LIGHT1' },
      }),
    )
    expect(read.theme.background).toBe('#0d1a66')
    expect(read.theme.text).toBe('#ffffff')
  })

  it('still takes the scheme’s text colour when the deck agrees with it', () => {
    const read = toSourcePresentation(
      paletteDeck(DARK_SCHEME, [1, 1, 1], {
        opaqueColor: { themeColor: 'DARK1' },
      }),
    )
    expect(read.theme.text).toBe('#1c2130')
  })

  it('refuses a text colour that cannot be read on the background', () => {
    // Whatever the presentation says, a design nobody can read is not the
    // design that was imported
    const read = toSourcePresentation(
      paletteDeck(DARK_SCHEME, [0.05, 0.1, 0.4], {
        opaqueColor: { rgbColor: { red: 0.07, green: 0.12, blue: 0.42 } },
      }),
    )
    expect(read.theme.text).toBe('#ffffff')
  })

  it('falls back to the scheme when no slide states a text colour', () => {
    const read = toSourcePresentation(
      paletteDeck(DARK_SCHEME, [1, 1, 1], undefined),
    )
    expect(read.theme.text).toBe('#1c2130')
  })

  it('keeps the muted and accent colours readable too', () => {
    const read = toSourcePresentation(
      paletteDeck(DARK_SCHEME, [0.05, 0.1, 0.4], {
        opaqueColor: { themeColor: 'LIGHT1' },
      }),
    )
    // DARK2 is too dark to read on this background, so it is not taken
    expect(read.theme.muted).not.toBe('#3d4a66')
    expect(read.theme.accent).toBe('#ffcc00')
  })

  it('lets the loudest body copy decide, not a one-word flourish', () => {
    // Weighted by how much text is in each colour
    const deck = paletteDeck(DARK_SCHEME, [1, 1, 1], {
      opaqueColor: { themeColor: 'DARK1' },
    })
    deck.slides[0]!.pageElements[0]!.shape.text.textElements.push({
      textRun: {
        content: '!\n',
        style: { foregroundColor: { opaqueColor: { themeColor: 'ACCENT1' } } },
      },
    } as never)
    expect(toSourcePresentation(deck).theme.text).toBe('#1c2130')
  })
})

/**
 * Google states measurements two ways in one response, and mixing them up is
 * how every shape in an imported deck ended up in the top-left corner with
 * its size intact.
 */
describe('the two ways Google states a measurement', () => {
  /** A shape exactly as the API returns one: a Dimension size, and a
   * transform whose translations are bare numbers with one unit. */
  const asGoogleReturnsIt = {
    objectId: 'shape-1',
    size: {
      width: { magnitude: 0.5 * PAGE.width, unit: 'EMU' },
      height: { magnitude: 0.25 * PAGE.height, unit: 'EMU' },
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: 0.1 * PAGE.width,
      translateY: 0.2 * PAGE.height,
      unit: 'EMU',
    },
    shape: {
      shapeType: 'TEXT_BOX',
      placeholder: { type: 'TITLE' },
      text: {
        textElements: [{ textRun: { content: 'Runoff\n', style: {} } }],
      },
    },
  }

  it('places a shape whose transform states bare numbers', () => {
    // The bug: translateX read as a Dimension has no magnitude, so it came
    // back 0 — and every box in the deck stacked in the corner
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [asGoogleReturnsIt] }],
      }),
    )
    expect(read.slides[0]!.elements[0]!.box).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.25,
    })
  })

  it('converts a translation stated in points', () => {
    const inPoints = {
      ...asGoogleReturnsIt,
      transform: {
        scaleX: 1,
        scaleY: 1,
        // 72pt to the inch, and the page is ten inches across
        translateX: 72,
        translateY: 72,
        unit: 'PT',
      },
    }
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [inPoints] }] }),
    )
    expect(read.slides[0]!.elements[0]!.box.x).toBeCloseTo(0.1, 5)
  })

  it('still accepts a translation given as a Dimension', () => {
    // Tolerated rather than required: a caller holding a Dimension should not
    // have to know which of the two conventions applies here
    const asDimension = {
      ...asGoogleReturnsIt,
      transform: {
        scaleX: 1,
        scaleY: 1,
        translateX: { magnitude: 0.1 * PAGE.width, unit: 'EMU' },
        translateY: { magnitude: 0.2 * PAGE.height, unit: 'EMU' },
      },
    }
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [asDimension] }],
      }),
    )
    expect(read.slides[0]!.elements[0]!.box.x).toBeCloseTo(0.1, 5)
  })

  it('does not stack a slide’s boxes in the corner', () => {
    // The shape of the failure, asserted directly: distinct shapes must get
    // distinct origins
    const second = {
      ...asGoogleReturnsIt,
      objectId: 'shape-2',
      transform: {
        scaleX: 1,
        scaleY: 1,
        translateX: 0.1 * PAGE.width,
        translateY: 0.6 * PAGE.height,
        unit: 'EMU',
      },
    }
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [asGoogleReturnsIt, second] }],
      }),
    )
    const origins = read.slides[0]!.elements.map(e => `${e.box.x},${e.box.y}`)
    expect(new Set(origins).size).toBe(2)
  })
})

describe('what a shape is, not just where it is', () => {
  it('keeps the kind of shape a decoration is', () => {
    // An arrow across the top of a slide is an arrow. Read as a bare box it
    // imports as a grey rectangle, which is the most visible way a design
    // stops looking like itself.
    const arrow = shape({
      shape: {
        shapeType: 'RIGHT_ARROW',
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: { color: { themeColor: 'ACCENT1' } },
          },
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [arrow] }] }),
    )
    expect(read.slides[0]!.elements[0]).toMatchObject({
      kind: 'decoration',
      shapeType: 'RIGHT_ARROW',
    })
  })

  it('says nothing about a shape the presentation did not name', () => {
    const plain = shape({
      shape: {
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: { color: { themeColor: 'ACCENT1' } },
          },
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [plain] }] }),
    )
    expect(read.slides[0]!.elements[0]).not.toHaveProperty('shapeType')
  })
})

describe('a placeholder nobody has typed into yet', () => {
  const pt = (magnitude: number) => ({ magnitude, unit: 'PT' })

  /** A deck whose layout states the type, and whose slide is untouched. */
  const untouched = () => ({
    presentationId: 'p1',
    title: 'Untouched',
    pageSize: { width: dim(PAGE.width), height: dim(PAGE.height) },
    masters: [
      {
        objectId: 'm',
        pageProperties: {
          colorScheme: {
            colors: [{ type: 'LIGHT1', color: { red: 1, green: 1, blue: 1 } }],
          },
        },
        pageElements: [],
      },
    ],
    layouts: [
      {
        objectId: 'l',
        layoutProperties: { masterObjectId: 'm' },
        pageElements: [
          {
            objectId: 'l-title',
            size: {
              width: dim(0.84 * PAGE.width),
              height: dim(0.18 * PAGE.height),
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 0.08 * PAGE.width,
              translateY: 0.1 * PAGE.height,
              unit: 'EMU',
            },
            shape: {
              shapeType: 'TEXT_BOX',
              placeholder: { type: 'TITLE' },
              text: {
                textElements: [
                  {
                    paragraphMarker: { style: { alignment: 'CENTER' } },
                  },
                  {
                    textRun: {
                      content: 'Click to edit Master title style',
                      style: {
                        fontSize: pt(36),
                        bold: true,
                        foregroundColor: {
                          opaqueColor: { themeColor: 'LIGHT1' },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
    slides: [
      {
        objectId: 's1',
        slideProperties: { layoutObjectId: 'l', masterObjectId: 'm' },
        pageElements: [
          {
            objectId: 's1-title',
            shape: {
              shapeType: 'TEXT_BOX',
              // No text at all: the author never typed into it
              placeholder: { type: 'TITLE', parentObjectId: 'l-title' },
            },
          },
        ],
      },
    ],
  })

  it('is set in the type its design says, though it holds no words', () => {
    // Size, weight and colour are read off the RUNS, and an empty box has
    // none — so a deck of untouched placeholders imported with no type at
    // all, and its title came out the same size as its body
    const element = toSourcePresentation(untouched()).slides[0]!.elements[0]!
    expect(element.runs?.[0]).toMatchObject({
      text: '',
      fontSize: 5,
      bold: true,
      color: '#ffffff',
    })
  })

  it('holds no words, so it is not mistaken for content', () => {
    const element = toSourcePresentation(untouched()).slides[0]!.elements[0]!
    expect(element.runs?.map(r => r.text).join('')).toBe('')
  })

  it('keeps the alignment its design sets, too', () => {
    const element = toSourcePresentation(untouched()).slides[0]!.elements[0]!
    expect(element.align).toBe('center')
  })
})

describe('a deck whose colour lives on its boxes', () => {
  it('keeps a text box’s own fill', () => {
    // Not every deck paints its pages. One that colours its boxes instead
    // imported white, because a shape's fill was read only when it held no
    // words — a box with text lost it.
    const filled = shape({
      shape: {
        shapeType: 'TEXT_BOX',
        placeholder: { type: 'TITLE' },
        shapeProperties: {
          shapeBackgroundFill: {
            propertyState: 'RENDERED',
            solidFill: {
              color: { rgbColor: { red: 1, green: 0.85, blue: 0 } },
            },
          },
        },
        text: {
          textElements: [
            { textRun: { content: 'Save the date\n', style: {} } },
          ],
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [filled] }] }),
    )
    expect(read.slides[0]!.elements[0]).toMatchObject({
      kind: 'text',
      fill: '#ffd900',
    })
  })

  it('says nothing for a box the deck left unfilled', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [{ objectId: 's1', pageElements: [textShape('Plain')] }],
      }),
    )
    expect(read.slides[0]!.elements[0]).not.toHaveProperty('fill')
  })
})

/**
 * Reading the presentation from Google — the one stage whose failure stops an
 * import (TMPL-8).
 *
 * Untested until an import failed in the field and said "Something went
 * wrong", which is what an unclassified error looks like from the outside.
 * What matters is that each refusal is told apart, because they ask the user
 * for different things.
 */
describe('when Google will not hand the presentation over', () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = (status: number, body = '{}') =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status })),
    )

  it('asks for a reconnect when the grant does not cover it', async () => {
    respond(403, '{"error":{"message":"insufficient permissions"}}')
    const err = await readPresentationLive('t', 'p').catch(e => e)
    expect(err).toBeInstanceOf(PresentationUnreadableError)
    expect(err.reconnect).toBe(true)
  })

  it('does not, when the Slides API is switched off for the deployment', async () => {
    // Google answers 403 for this too, but reconnecting cannot fix it — and
    // telling an instructor to try sends them round a loop that never ends
    respond(
      403,
      '{"error":{"message":"Google Slides API has not been used in project 1234 before or it is disabled"}}',
    )
    const err = await readPresentationLive('t', 'p').catch(e => e)
    expect(err.reconnect).toBe(false)
    expect(err.message).toMatch(/not enabled for this deployment/i)
  })

  it('does not ask for one when the deck simply is not theirs to open', async () => {
    // The common case, and the one this used to get wrong: an instructor
    // pastes a link to a colleague's lecture. Nothing is wrong with their
    // connection, so reconnecting sends them through the consent screen to
    // arrive back at exactly the same refusal. What they need is access.
    respond(
      403,
      '{"error":{"status":"PERMISSION_DENIED","message":"The caller does not have permission"}}',
    )
    const err = await readPresentationLive('t', 'p').catch(e => e)
    expect(err.forbidden).toBe(true)
    expect(err.reconnect).toBe(false)
  })

  it('asks for one when the stored token has gone stale', async () => {
    respond(401, '{"error":{"message":"Invalid Credentials"}}')
    const err = await readPresentationLive('t', 'p').catch(e => e)
    expect(err.reconnect).toBe(true)
    expect(err.forbidden).toBe(false)
  })

  it('says a missing presentation is missing', async () => {
    respond(404)
    const err = await readPresentationLive('t', 'p').catch(e => e)
    expect(err.notFound).toBe(true)
    expect(err.reconnect).toBe(false)
  })

  it('reports any other status without guessing why', async () => {
    respond(500)
    await expect(readPresentationLive('t', 'p')).rejects.toThrow(/500/)
  })

  it('reads the presentation when Google does hand it over', async () => {
    respond(200, JSON.stringify({ presentationId: 'p', slides: [] }))
    await expect(readPresentationLive('t', 'p')).resolves.toMatchObject({
      slides: [],
    })
  })
})

/**
 * A box that states a fill it does not paint.
 *
 * Google puts a colour on shapes that have no fill at all — inherited from
 * the placeholder or the master — and says so in `propertyState`. Reading the
 * colour without reading that painted a white rectangle behind every title on
 * a dark deck. The text was white too, so the slide imported apparently
 * blank: a white box with white words in it.
 *
 * The page-background reader had honoured `propertyState` from the start;
 * this is the shape reader catching up, and both now go through one helper so
 * they cannot drift apart again.
 */
describe('a fill the shape does not actually paint', () => {
  const titled = (fill: Record<string, unknown>) =>
    toSourcePresentation({
      presentationId: 'p',
      pageSize: { width: dim(PAGE.width), height: dim(PAGE.height) },
      slides: [
        {
          objectId: 's1',
          pageElements: [
            {
              objectId: 's1-t',
              size: { width: dim(PAGE.width / 2), height: dim(EMU) },
              transform: {
                translateX: 0,
                translateY: 0,
                scaleX: 1,
                scaleY: 1,
                unit: 'EMU',
              },
              shape: {
                placeholder: { type: 'TITLE' },
                shapeProperties: { shapeBackgroundFill: fill },
                text: {
                  textElements: [
                    { textRun: { content: 'Rainwater Harvesting' } },
                  ],
                },
              },
            },
          ],
        },
      ],
    }).slides[0]!.elements[0]!

  it('is not carried when the box renders no fill', () => {
    const el = titled({
      propertyState: 'NOT_RENDERED',
      solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
    })
    expect(el.fill).toBeUndefined()
  })

  it('is not carried when the box defers to what it descends from', () => {
    const el = titled({
      propertyState: 'INHERIT',
      solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
    })
    expect(el.fill).toBeUndefined()
  })

  it('is carried when the box really is painted', () => {
    // The case #238 fixed stays fixed: a deck that colours its text boxes
    // rather than its pages must not import white
    const el = titled({
      propertyState: 'RENDERED',
      solidFill: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } },
    })
    expect(el.fill).toBe('#ff0000')
  })

  it('is carried when Google states no property state at all', () => {
    const el = titled({
      solidFill: { color: { rgbColor: { red: 0, green: 0, blue: 1 } } },
    })
    expect(el.fill).toBe('#0000ff')
  })
})

/**
 * Lines broken inside one paragraph.
 *
 * Slides writes those as a vertical tab rather than a newline. A list
 * exported from this app, converted by Drive and read back can arrive that
 * way, and read literally it is one unbroken run — which is how four bullet
 * points came home as a single paragraph.
 */
describe('a line broken inside a paragraph', () => {
  it('reads as a line break, not as part of the words', () => {
    const box = shape({
      shape: {
        shapeType: 'TEXT_BOX',
        text: {
          textElements: [
            { paragraphMarker: { bullet: {} } },
            { textRun: { content: 'One\vTwo\vThree\vFour\n', style: {} } },
          ],
        },
      },
    })
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [box] }] }),
    )
    const element = read.slides[0]!.elements[0]!
    expect(element.runs?.map(r => r.text)).toEqual(['One\nTwo\nThree\nFour'])
    expect(element.bulleted).toBe(true)
  })
})

/**
 * Where one paragraph ends and the next begins.
 *
 * Slides ends each paragraph with a newline. Dropping it flattened a box to
 * its words — a four-point list read as "OneTwoThreeFour" — and
 * `linesIn` in consolidation, which counts a list by splitting on newlines,
 * therefore counted every list as one line when deriving its ceiling
 * (TMPL-6).
 */
describe('a box of several paragraphs', () => {
  const listBox = () =>
    shape({
      shape: {
        shapeType: 'TEXT_BOX',
        text: {
          textElements: [
            { paragraphMarker: { bullet: {} } },
            { textRun: { content: 'One\n', style: {} } },
            { paragraphMarker: { bullet: {} } },
            { textRun: { content: 'Two\n', style: {} } },
            { paragraphMarker: { bullet: {} } },
            { textRun: { content: 'Three\n', style: {} } },
          ],
        },
      },
    })

  it('keeps the breaks between them', () => {
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [listBox()] }] }),
    )
    const runs = read.slides[0]!.elements[0]!.runs ?? []
    expect(runs.map(r => r.text).join('')).toBe('One\nTwo\nThree')
  })

  it('keeps a space that arrived as a run of its own', () => {
    // Google splits a run wherever styling changes, so the gap between a bold
    // word and a plain one is often a run holding nothing but a space. Drop
    // it and the two words join up.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              shape({
                shape: {
                  shapeType: 'TEXT_BOX',
                  text: {
                    textElements: [
                      { paragraphMarker: {} },
                      { textRun: { content: 'Bold', style: { bold: true } } },
                      { textRun: { content: ' ', style: {} } },
                      { textRun: { content: 'plain\n', style: {} } },
                    ],
                  },
                },
              }),
            ],
          },
        ],
      }),
    )
    const runs = read.slides[0]!.elements[0]!.runs ?? []
    expect(runs.map(r => r.text).join('')).toBe('Bold plain')
  })

  it('does not leave the last one dangling', () => {
    // The final newline ends the box, not a line inside it.
    const read = toSourcePresentation(
      presentation({ slides: [{ objectId: 's1', pageElements: [listBox()] }] }),
    )
    const runs = read.slides[0]!.elements[0]!.runs ?? []
    expect(runs[runs.length - 1]!.text.endsWith('\n')).toBe(false)
  })
})

/**
 * The same four-point list, written every way Slides writes one.
 *
 * Google does not commit to a shape. A paragraph may end with a newline or
 * not; a line broken inside one arrives as a vertical tab; and a run is split
 * wherever styling changes, so a point with a bold word in it is three runs.
 * Reading the structure off the content is guesswork against all that — a
 * list came back as one paragraph in some of these shapes, and gained points
 * it never had in others.
 *
 * The paragraph markers are what actually say where a line ends, so the
 * reader states the break rather than inferring it, and every shape below
 * comes back as the four points the author wrote.
 */
describe('a four-point list, however Slides encodes it', () => {
  const marker = (bulleted = true) => ({
    paragraphMarker: bulleted ? { bullet: {} } : {},
  })
  const run = (content: string) => ({ textRun: { content, style: {} } })

  const ENCODINGS: Record<string, unknown[]> = {
    'a paragraph per point, each ending in a newline': [
      marker(),
      run('One\n'),
      marker(),
      run('Two\n'),
      marker(),
      run('Three\n'),
      marker(),
      run('Four\n'),
    ],
    'the last point left without its newline': [
      marker(),
      run('One\n'),
      marker(),
      run('Two\n'),
      marker(),
      run('Three\n'),
      marker(),
      run('Four'),
    ],
    'no newlines at all, only the markers': [
      marker(),
      run('One'),
      marker(),
      run('Two'),
      marker(),
      run('Three'),
      marker(),
      run('Four'),
    ],
    'one paragraph, its lines broken by vertical tabs': [
      marker(),
      run('One\vTwo\vThree\vFour\n'),
    ],
    'a point split in two by its styling': [
      marker(),
      run('One\n'),
      marker(),
      run('T'),
      run('wo\n'),
      marker(),
      run('Three\n'),
      marker(),
      run('Four\n'),
    ],
    'an empty paragraph trailing the list': [
      marker(),
      run('One\n'),
      marker(),
      run('Two\n'),
      marker(),
      run('Three\n'),
      marker(),
      run('Four\n'),
      marker(),
      run('\n'),
    ],
  }

  /** The points a box holds, read the way the importer reads them. */
  const pointsIn = (elements: unknown[]): string[] => {
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              shape({
                shape: {
                  shapeType: 'TEXT_BOX',
                  text: { textElements: elements },
                },
              }),
            ],
          },
        ],
      }),
    )
    return (read.slides[0]!.elements[0]!.runs ?? [])
      .map(r => r.text)
      .join('')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }

  for (const [shapeOfIt, elements] of Object.entries(ENCODINGS)) {
    it(`is four points when written as ${shapeOfIt}`, () => {
      expect(pointsIn(elements)).toEqual(['One', 'Two', 'Three', 'Four'])
    })
  }
})

/**
 * Where a picture came from, when its alt text did not survive.
 *
 * The provenance rides on the picture's alt text (IMG-5/EXP-8), which states
 * every field including the URLs. But alt text stops being ours the moment
 * the file leaves: a conversion can drop it and an editor can clear it, and
 * the credit would go with it — silently, on a licence that requires it.
 *
 * The printed line under the picture cannot go missing, because it is on the
 * page. So it doubles as the second copy.
 */
describe('a picture whose credit outlived its alt text', () => {
  const PRINTED = '"Mitochondrion" by Ada via Wikimedia — CC BY-SA 4.0'
  const TOKEN =
    'credit:{"title":"Mitochondrion","creator":"Ada","sourceName":"Wikimedia",' +
    '"license":"CC BY-SA 4.0","sourceUrl":"https://commons.test/m"}'

  const read = (altText?: string) =>
    toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              {
                ...shape({}, { x: 0.2, y: 0.2, w: 0.6, h: 0.5 }),
                objectId: 'pic',
                ...(altText ? { description: altText } : {}),
                image: { contentUrl: 'https://google.test/m.png' },
              },
              {
                ...shape({}, { x: 0.2, y: 0.72, w: 0.6, h: 0.06 }),
                objectId: 'credit',
                description: 'credit-line',
                shape: {
                  shapeType: 'TEXT_BOX',
                  text: {
                    textElements: [
                      { paragraphMarker: {} },
                      { textRun: { content: `${PRINTED}\n`, style: {} } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      }),
    )

  it('is credited from the printed line when the alt text is gone', () => {
    const picture = read().slides[0]!.elements.find(e => e.kind === 'image')
    expect(picture?.attribution).toEqual({
      title: 'Mitochondrion',
      creator: 'Ada',
      sourceName: 'Wikimedia',
      license: 'CC BY-SA 4.0',
    })
  })

  it('prefers the alt text, which states more than a printed line can', () => {
    const picture = read(TOKEN).slides[0]!.elements.find(
      e => e.kind === 'image',
    )
    // The source URL has no place in the printed form, and is why alt text
    // wins wherever it survived.
    expect(picture?.attribution?.sourceUrl).toBe('https://commons.test/m')
  })

  it('leaves the printed line off the slide either way', () => {
    // It is on the page, not in the lecture: read as content it comes back as
    // a caption the author never wrote.
    for (const source of [read(), read(TOKEN)]) {
      const words = source.slides[0]!.elements.flatMap(e =>
        (e.runs ?? []).map(r => r.text),
      )
      expect(words.join('')).not.toContain('Wikimedia')
    }
  })
})

/**
 * The design behind a slide, which the slide's own elements do not include
 * (TMPL-8).
 *
 * A rule under every title, a coloured band down the side, a block behind the
 * heading: an author draws those once on the layout or the master, and Google
 * does not repeat them in each slide's `pageElements`. Reading only the slide
 * lost them — and lost them unevenly, because a slide where the author had
 * copied the rule onto the slide itself kept it while its neighbour did not.
 * The same deck came back with the line on some slides and not others.
 */
describe('the rules and bands a slide inherits', () => {
  const band = (
    id: string,
    y: number,
    hex: { red: number; green: number; blue: number },
  ) => ({
    objectId: id,
    transform: {
      translateX: 0,
      translateY: y,
      scaleX: 1,
      scaleY: 1,
      unit: 'EMU',
    },
    size: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 91440, unit: 'EMU' },
    },
    shape: {
      shapeType: 'RECTANGLE',
      shapeProperties: {
        shapeBackgroundFill: { solidFill: { color: { rgbColor: hex } } },
      },
    },
  })

  const green = { red: 0, green: 0.6, blue: 0.2 }

  /** A deck whose green rule lives on the layout, as an author would draw it. */
  const deck = (slideElements: Record<string, unknown>[] = []) => ({
    presentationId: 'p',
    pageSize: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 5143500, unit: 'EMU' },
    },
    masters: [{ objectId: 'm1', pageElements: [] }],
    layouts: [
      {
        objectId: 'l1',
        layoutProperties: {
          masterObjectId: 'm1',
          displayName: 'TITLE_AND_BODY',
        },
        pageElements: [band('rule', 1000000, green)],
      },
    ],
    slides: [
      {
        objectId: 's1',
        slideProperties: { layoutObjectId: 'l1', masterObjectId: 'm1' },
        pageElements: slideElements,
      },
    ],
  })

  /** The decoration on the first slide, as read. */
  const decorationOf = (raw: Record<string, unknown>) =>
    toSourcePresentation(raw).slides[0]!.elements.filter(
      e => e.kind === 'decoration',
    )

  it('draws a rule the layout states, not only one the slide repeats', () => {
    const drawn = decorationOf(deck())
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.fill).toBe('#009933')
  })

  it('draws it once when the author copied it onto the slide as well', () => {
    // Two slides of the same deck differ only in whether the author pasted
    // the rule onto the slide. They must not come back one ruled twice.
    const drawn = decorationOf(deck([band('copy', 1000000, green)]))
    expect(drawn).toHaveLength(1)
  })

  it('keeps a band the slide draws that the design does not', () => {
    const drawn = decorationOf(deck([band('own', 3000000, green)]))
    expect(drawn).toHaveLength(2)
  })

  it('puts the design behind what the slide draws on top of it', () => {
    const elements = toSourcePresentation(deck([band('own', 3000000, green)]))
      .slides[0]!.elements
    expect(elements[0]!.id).toBe('rule')
  })
})

/**
 * The pictures a design draws (TMPL-8).
 *
 * A crest in the corner and a pattern behind the type are `image` elements on
 * the layout or the master, not filled shapes — and only the filled ones were
 * kept, so a branded deck imported as a flat colour with no mark on it.
 */
describe('the pictures a slide inherits from its design', () => {
  const picture = (id: string, url: string, x: number) => ({
    objectId: id,
    transform: {
      translateX: x,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      unit: 'EMU',
    },
    size: {
      width: { magnitude: 914400, unit: 'EMU' },
      height: { magnitude: 457200, unit: 'EMU' },
    },
    image: { contentUrl: url },
  })

  const deck = (options: {
    layout?: Record<string, unknown>[]
    master?: Record<string, unknown>[]
    slide?: Record<string, unknown>[]
  }) => ({
    presentationId: 'p',
    pageSize: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 5143500, unit: 'EMU' },
    },
    masters: [{ objectId: 'm1', pageElements: options.master ?? [] }],
    layouts: [
      {
        objectId: 'l1',
        layoutProperties: { masterObjectId: 'm1' },
        pageElements: options.layout ?? [],
      },
    ],
    slides: [
      {
        objectId: 's1',
        slideProperties: { layoutObjectId: 'l1', masterObjectId: 'm1' },
        pageElements: options.slide ?? [],
      },
    ],
  })

  const decorationOf = (raw: Record<string, unknown>) =>
    toSourcePresentation(raw).slides[0]!.elements.filter(
      e => e.kind === 'decoration',
    )

  it('brings across a logo the layout draws', () => {
    const drawn = decorationOf(
      deck({ layout: [picture('crest', 'https://x.invalid/crest.png', 0)] }),
    )
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.imageUrl).toBe('https://x.invalid/crest.png')
  })

  it('brings across one the master draws, behind the layout', () => {
    const drawn = decorationOf(
      deck({ master: [picture('mark', 'https://x.invalid/mark.png', 0)] }),
    )
    expect(drawn.map(d => d.imageUrl)).toEqual(['https://x.invalid/mark.png'])
  })

  it('keeps two different marks that sit in the same corner', () => {
    // Keyed without the picture, the master's would be discarded as a repeat
    // of the layout's — same box, same absent fill.
    const drawn = decorationOf(
      deck({
        layout: [picture('a', 'https://x.invalid/a.png', 0)],
        master: [picture('b', 'https://x.invalid/b.png', 0)],
      }),
    )
    // The master's first: order is paint order, and the layout's mark sits on
    // top of what the master puts behind it.
    expect(drawn.map(d => d.imageUrl)).toEqual([
      'https://x.invalid/b.png',
      'https://x.invalid/a.png',
    ])
  })

  it('does not draw it twice when the slide carries its own copy', () => {
    const drawn = decorationOf(
      deck({
        layout: [picture('crest', 'https://x.invalid/crest.png', 0)],
        slide: [picture('copy', 'https://x.invalid/crest.png', 0)],
      }),
    )
    expect(drawn).toHaveLength(0)
    // The slide's own copy is still there, as the picture it is.
    const images = toSourcePresentation(
      deck({
        layout: [picture('crest', 'https://x.invalid/crest.png', 0)],
        slide: [picture('copy', 'https://x.invalid/crest.png', 0)],
      }),
    ).slides[0]!.elements.filter(e => e.kind === 'image')
    expect(images).toHaveLength(1)
  })

  it('leaves a picture on the slide itself as content', () => {
    const elements = toSourcePresentation(
      deck({ slide: [picture('figure', 'https://x.invalid/figure.png', 0)] }),
    ).slides[0]!.elements
    expect(elements.map(e => e.kind)).toEqual(['image'])
  })
})

/**
 * A group, which Google returns as one element with its parts nested inside it
 * (TMPL-8).
 *
 * Nothing read a group — it is neither an image, nor a table, nor a shape — so
 * it was skipped whole, and a crest that is a mark beside a wordmark went
 * missing along with everything else anyone had ever grouped.
 */
describe('a shape inside a group', () => {
  const deck = (elements: Record<string, unknown>[]) => ({
    presentationId: 'p',
    pageSize: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 5143500, unit: 'EMU' },
    },
    masters: [{ objectId: 'm1', pageElements: [] }],
    layouts: [{ objectId: 'l1', layoutProperties: { masterObjectId: 'm1' } }],
    slides: [
      {
        objectId: 's1',
        slideProperties: { layoutObjectId: 'l1', masterObjectId: 'm1' },
        pageElements: elements,
      },
    ],
  })

  /** A group offset a quarter of the way across, holding one picture that is
   * itself offset a further quarter within the group. */
  const grouped = {
    objectId: 'g1',
    transform: {
      translateX: 2286000,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      unit: 'EMU',
    },
    size: {
      width: { magnitude: 2286000, unit: 'EMU' },
      height: { magnitude: 1285875, unit: 'EMU' },
    },
    elementGroup: {
      children: [
        {
          objectId: 'mark',
          transform: {
            translateX: 2286000,
            translateY: 0,
            scaleX: 1,
            scaleY: 1,
            unit: 'EMU',
          },
          size: {
            width: { magnitude: 914400, unit: 'EMU' },
            height: { magnitude: 457200, unit: 'EMU' },
          },
          image: { contentUrl: 'https://x.invalid/mark.png' },
        },
      ],
    },
  }

  it('reads the parts of a group rather than skipping it whole', () => {
    const elements = toSourcePresentation(deck([grouped])).slides[0]!.elements
    expect(elements.map(e => e.id)).toEqual(['mark'])
    expect(elements[0]!.imageUrl).toBe('https://x.invalid/mark.png')
  })

  it('places a part where the group puts it, not where it sits inside it', () => {
    // Its own transform says a quarter across; the group's adds another
    // quarter. Read without the group it would land at 0.25 — half a slide
    // from where the author drew it.
    const box = toSourcePresentation(deck([grouped])).slides[0]!.elements[0]!
      .box
    expect(box.x).toBeCloseTo(0.5, 5)
    expect(box.w).toBeCloseTo(0.1, 5)
  })

  it('scales a part by the group it is in', () => {
    const scaled = {
      ...grouped,
      transform: { ...grouped.transform, scaleX: 2, scaleY: 2 },
    }
    const box = toSourcePresentation(deck([scaled])).slides[0]!.elements[0]!.box
    // Twice the size, and twice as far across before the group's own offset.
    expect(box.w).toBeCloseTo(0.2, 5)
    expect(box.x).toBeCloseTo(0.75, 5)
  })
})

/**
 * A theme colour asked for under a name the master's scheme does not list
 * (TMPL-8).
 *
 * Google lists a master's scheme under one set of names and lets a text style
 * ask for the same colour under another — `TEXT1` and `DARK1` are one entry.
 * A miss is not an error: it silently drops the colour, and the box falls back
 * to the deck's default ink, which is how a heading set in red came back
 * black.
 */
describe('a colour named one way and listed another', () => {
  const deck = (themeColor: string) => ({
    presentationId: 'p',
    pageSize: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 5143500, unit: 'EMU' },
    },
    masters: [
      {
        objectId: 'm1',
        pageProperties: {
          colorScheme: {
            colors: [
              { type: 'DARK1', color: { red: 0.8, green: 0, blue: 0 } },
              { type: 'ACCENT1', color: { red: 0, green: 0, blue: 0.9 } },
            ],
          },
        },
        pageElements: [],
      },
    ],
    layouts: [],
    slides: [
      {
        objectId: 's1',
        slideProperties: { masterObjectId: 'm1' },
        pageElements: [
          {
            objectId: 'title',
            transform: {
              translateX: 0,
              translateY: 0,
              scaleX: 1,
              scaleY: 1,
              unit: 'EMU',
            },
            size: {
              width: { magnitude: 4572000, unit: 'EMU' },
              height: { magnitude: 914400, unit: 'EMU' },
            },
            shape: {
              text: {
                textElements: [
                  {
                    textRun: {
                      content: 'Heading\n',
                      style: {
                        foregroundColor: { opaqueColor: { themeColor } },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  })

  const colourOf = (themeColor: string) =>
    toSourcePresentation(deck(themeColor)).slides[0]!.elements[0]!.runs?.[0]
      ?.color

  it('finds it under the name the scheme does list', () => {
    expect(colourOf('TEXT1')).toBe('#cc0000')
  })

  it('still finds one asked for by its own name', () => {
    expect(colourOf('ACCENT1')).toBe('#0000e6')
  })

  it('leaves a colour it genuinely cannot resolve unset', () => {
    // Better than inventing one: an unset colour takes the deck's ink, which
    // is at least a colour the deck chose.
    expect(colourOf('ACCENT6')).toBeUndefined()
  })
})

/**
 * The colour a deck draws its links in (TMPL-8).
 *
 * A box is stored with one colour and every run inside it is drawn in that
 * one — and the run an author coloured differently is nearly always a link.
 * A deck whose links were red got them in the body's black, because the box
 * took the colour of its first run. The link colour belongs to the design, so
 * it rides on the theme.
 */
describe('a deck that colours its links', () => {
  const withScheme = (colors: Record<string, [number, number, number]>) => ({
    presentationId: 'p',
    pageSize: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 5143500, unit: 'EMU' },
    },
    masters: [
      {
        objectId: 'm1',
        pageProperties: {
          pageBackgroundFill: {
            solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
          },
          colorScheme: {
            colors: Object.entries(colors).map(
              ([type, [red, green, blue]]) => ({
                type,
                color: { red, green, blue },
              }),
            ),
          },
        },
        pageElements: [],
      },
    ],
    layouts: [],
    slides: [
      {
        objectId: 's1',
        slideProperties: { masterObjectId: 'm1' },
        pageElements: [],
      },
    ],
  })

  it('carries it, so a red link is drawn red', () => {
    const theme = toSourcePresentation(
      withScheme({
        DARK1: [0, 0, 0],
        ACCENT1: [0.2, 0.2, 0.2],
        HYPERLINK: [1, 0.32, 0.32],
      }),
    ).theme
    expect(theme.link).toBe('#ff5252')
  })

  it('carries none when the deck draws links like everything else', () => {
    // Not a decision worth carrying, and the app already draws a link in the
    // body colour when nothing says otherwise.
    const theme = toSourcePresentation(
      withScheme({ DARK1: [0, 0, 0], HYPERLINK: [0, 0, 0] }),
    ).theme
    expect(theme.link).toBeUndefined()
  })

  it('carries none when the colour could not be read on the page', () => {
    // A link nobody can see is worse than one in the body colour.
    const theme = toSourcePresentation(
      withScheme({ DARK1: [0, 0, 0], HYPERLINK: [1, 1, 1] }),
    ).theme
    expect(theme.link).toBeUndefined()
  })

  /**
   * A deck is not one background (TMPL-8).
   *
   * The theme carries one, but an imported design paints its own on every
   * layout. A link colour checked against the first slide alone is not thereby
   * readable on the rest — a deck that opens on a dark title page and then
   * runs white kept a near-white link, and every linked phrase after slide one
   * was drawn in white on white. The words were in the box; nothing drew them.
   */
  const dark = {
    pageBackgroundFill: {
      solidFill: { color: { rgbColor: { red: 0.1, green: 0, blue: 0.2 } } },
    },
  }
  const light = {
    pageBackgroundFill: {
      solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } },
    },
  }
  /** A deck that opens dark and then runs white, which is what a title page
   * over a photograph makes of an otherwise light template. */
  const darkThenLight = (colors: Record<string, [number, number, number]>) =>
    toSourcePresentation({
      ...withScheme(colors),
      slides: [
        { objectId: 's1', pageProperties: dark, pageElements: [] },
        { objectId: 's2', pageProperties: light, pageElements: [] },
      ],
    }).theme

  it('carries none when it reads on the first page but not the rest', () => {
    expect(
      darkThenLight({ DARK1: [1, 1, 1], HYPERLINK: [0.9, 0.9, 0.95] }).link,
    ).toBeUndefined()
  })

  /**
   * Dropping the link colour is not enough on its own.
   *
   * The client draws a link in `accent` when the theme states no link colour
   * (`client/src/components/slide/theme.ts`), so an accent picked against the
   * dark title slide inherits the very bug the link colour was dropped to
   * avoid — near-white text on the deck's white pages. Every theme colour has
   * to read everywhere, not just the one the links asked about.
   */
  /** A mid-tone that clears the bar on near-black AND on white — which a deep
   * red does not, being too dark to read on the opener. */
  const midRed: [number, number, number] = [0.7529, 0.2235, 0.1686]

  it('picks an accent that reads on the light pages too', () => {
    const theme = darkThenLight({
      DARK1: [1, 1, 1],
      // The deck offers a near-white accent first — fine on the dark opener,
      // invisible on everything after it — and a mid red second.
      ACCENT1: [0.95, 0.95, 1],
      ACCENT2: midRed,
    })
    expect(theme.accent).toBe('#c0392b')
  })

  it('keeps the deck’s own accent when it reads on every page', () => {
    const theme = darkThenLight({ DARK1: [1, 1, 1], ACCENT1: midRed })
    expect(theme.accent).toBe('#c0392b')
  })

  it('still carries one that reads on every page the deck paints', () => {
    const deck = withScheme({ DARK1: [0, 0, 0], HYPERLINK: [0.7, 0, 0] })
    const grey = {
      pageBackgroundFill: {
        solidFill: {
          color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } },
        },
      },
    }
    const theme = toSourcePresentation({
      ...deck,
      slides: [
        { objectId: 's1', pageProperties: grey, pageElements: [] },
        { objectId: 's2', pageProperties: grey, pageElements: [] },
      ],
    }).theme
    expect(theme.link).toBe('#b30000')
  })
})

/**
 * A list the author numbered, or lettered (TMPL-8).
 *
 * Google states the marker it renders — "1.", "a.", "iv." — on the paragraph
 * itself. The list's `glyphType` is the documented place for it, and a real
 * deck's lists came back stating nothing but a bullet style, so a slide
 * numbered "1. 2. 3." with "a. b. c." beneath it imported as six identical
 * dashes: the ordering the author meant, gone.
 */
describe('a point whose marker counts', () => {
  const paragraph = (text: string, bullet: Record<string, unknown>) => [
    { paragraphMarker: { bullet } },
    { textRun: { content: `${text}\n`, style: {} } },
  ]

  const deck = (elements: unknown[]) => ({
    presentationId: 'p',
    pageSize: {
      width: { magnitude: 9144000, unit: 'EMU' },
      height: { magnitude: 5143500, unit: 'EMU' },
    },
    masters: [{ objectId: 'm1', pageElements: [] }],
    layouts: [],
    slides: [
      {
        objectId: 's1',
        slideProperties: { masterObjectId: 'm1' },
        pageElements: [
          {
            objectId: 'body',
            transform: {
              translateX: 0,
              translateY: 0,
              scaleX: 1,
              scaleY: 1,
              unit: 'EMU',
            },
            size: {
              width: { magnitude: 4572000, unit: 'EMU' },
              height: { magnitude: 914400, unit: 'EMU' },
            },
            shape: { text: { textElements: elements } },
          },
        ],
      },
    ],
  })

  const runsOf = (elements: unknown[]) =>
    toSourcePresentation(deck(elements)).slides[0]!.elements[0]!.runs ?? []

  it('is read as ordered from the marker Google renders', () => {
    const runs = runsOf(
      paragraph('Author or creator', { listId: 'l1', glyph: '1.' }),
    )
    expect(runs[0]!.ordered).toBe(true)
  })

  it('reads a lettered sub-point as ordered too', () => {
    const runs = runsOf(
      paragraph('Who (population)', {
        listId: 'l1',
        glyph: 'a.',
        nestingLevel: 1,
      }),
    )
    expect(runs[0]!.ordered).toBe(true)
    expect(runs[0]!.bulletLevel).toBe(1)
  })

  it('leaves a plain bullet unordered, symbol and all', () => {
    // Including "o": Word draws a level-two point with it, and a deck that
    // reached Slides through PowerPoint brings that with it. A bare letter is
    // a bullet — one only counts when something separates it from the text,
    // the way "a." and "iv)" do.
    const bullets = ['●', '○', '■', '◆', '▪', '-', '–', '‣', '➔', '✓', 'o', '§']
    for (const glyph of bullets) {
      expect(
        runsOf(paragraph('A point', { listId: 'l1', glyph }))[0]!.ordered,
      ).toBeUndefined()
    }
  })

  it('counts a marker however the deck writes it', () => {
    // Not only "1." — decks number with brackets, letters and roman numerals,
    // and in scripts whose digits are not 0-9. Reading any of those as a
    // bullet throws away an ordering the author meant.
    const counted = [
      '1.',
      '2)',
      'a.',
      'b)',
      'iv.',
      'IX.',
      'A:',
      '(1)',
      '١.',
      '१.',
    ]
    for (const glyph of counted) {
      expect(
        runsOf(paragraph('A point', { listId: 'l1', glyph }))[0]!.ordered,
      ).toBe(true)
    }
  })

  it('still reads the list’s own glyphType where the paragraph states no glyph', () => {
    // The documented place for it, and the only answer for a deck that does
    // fill it in.
    const raw = deck(paragraph('One', { listId: 'l1' }))
    ;(
      raw.slides[0]!.pageElements[0]!.shape.text as Record<string, unknown>
    ).lists = {
      l1: { nestingLevel: { '0': { glyphType: 'DIGIT' } } },
    }
    expect(
      toSourcePresentation(raw).slides[0]!.elements[0]!.runs?.[0]?.ordered,
    ).toBe(true)
  })
})

describe('a rule the design draws', () => {
  const rule = (transform: Record<string, unknown>) => ({
    objectId: 'rule-1',
    size: { width: dim(3000000), height: dim(3000000) },
    transform: { ...transform, unit: 'EMU' },
    line: {
      lineProperties: {
        lineFill: {
          solidFill: {
            color: { rgbColor: { red: 0.5372549, blue: 0.88235295 } },
          },
        },
        weight: dim(76200),
      },
      lineType: 'STRAIGHT_CONNECTOR_1',
    },
  })

  it('reads a horizontal one as the thin rectangle it draws', () => {
    // Google sends these as `line`, not `shape`, and the reader had no case
    // for the type — so the deck's most repeated motif after its logo was
    // dropped from every layout it appears on.
    //
    // Two things it must get right. An OMITTED scale on a line means zero,
    // not one: `scaleX` alone is a horizontal rule, and reading the missing
    // `scaleY` as 1 makes a three-inch square out of a hairline. And the
    // thickness is not in the box at all — it is `weight`.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              rule({ scaleX: 0.2072, translateX: 418229, translateY: 2012625 }),
            ],
          },
        ],
      }),
    )
    const drawn = read.slides[0]!.elements[0]!
    expect(drawn.kind).toBe('decoration')
    expect(drawn.fill).toBe('#8900e1')
    expect(drawn.box.w).toBeCloseTo((3000000 * 0.2072) / (10 * EMU), 6)
    // The weight, as a fraction of the page's height — not the box's height,
    // which is zero.
    expect(drawn.box.h).toBeCloseTo(76200 / (5.625 * EMU), 6)
  })

  it('reads a vertical one the same way round', () => {
    // The same reading with the axes swapped: the length is the scaled
    // extent, the WEIGHT is the thickness, and neither is the box Google
    // sends.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              rule({ scaleY: 1.7294, translateX: 4572004, translateY: 0 }),
            ],
          },
        ],
      }),
    )
    const drawn = read.slides[0]!.elements[0]!
    // This is NYU's own seam, and it is drawn slightly LONGER than the page:
    // 1.0087 of it, the way a designer draws a full-bleed rule by running it
    // past both edges rather than measuring it. A box is a fraction of the
    // page, so the reader clamps it to the page — which draws the same rule
    // and is the only value the template schema accepts. Asserted as the
    // clamp rather than as the raw arithmetic, which no box can hold.
    expect((3000000 * 1.7294) / (5.625 * EMU)).toBeGreaterThan(1)
    expect(drawn.box.y).toBe(0)
    expect(drawn.box.h).toBe(1)
    expect(drawn.box.w).toBeCloseTo(76200 / (10 * EMU), 6)
  })

  it('centres the stroke on its path rather than starting it there', () => {
    // REGRESSION, and it shipped looking correct. A line's transform gives
    // the stroke's CENTRELINE and the ink straddles it; read as the leading
    // edge, every rule is displaced by half its own weight along its
    // thickness axis. On white space that is four pixels and invisible. The
    // one rule that landed on a picture's edge is what gave it away.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              rule({ scaleX: 0.2072, translateX: 0, translateY: 2012625 }),
            ],
          },
        ],
      }),
    )
    const drawn = read.slides[0]!.elements[0]!
    // Half the weight above the path, half below.
    expect(drawn.box.y).toBeCloseTo((2012625 - 76200 / 2) / (5.625 * EMU), 6)
    // And the other axis is untouched: only the thickness axis moved.
    expect(drawn.box.x).toBe(0)
  })

  it('leaves a diagonal alone rather than drawing a slab', () => {
    // A diagonal has no rectangle that stands for it, and a box across the
    // slide is worse than the stroke being missing.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [
              rule({ scaleX: 0.5, scaleY: 0.5, translateX: 0, translateY: 0 }),
            ],
          },
        ],
      }),
    )
    expect(read.slides[0]!.elements).toHaveLength(0)
    // And says so. A deck that never had the stroke and a deck whose stroke
    // we declined look identical afterwards; only the count tells them apart.
    expect(read.rulesDeclined).toBe(1)
  })

  it('counts nothing for a deck whose rules it could all draw', () => {
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [rule({ scaleX: 0.2, translateX: 0, translateY: 0 })],
          },
        ],
      }),
    )
    expect(read.rulesDeclined).toBeUndefined()
  })
})

describe('a page the author marked not-for-presentation', () => {
  it('is read as skipped, so the import can leave it out', () => {
    // Google's "skip slide". A template deck marks its own instructions page
    // this way, and a layout derived from that page is a design the deck does
    // not have. The reader only reports it — leaving it out is the importer's
    // decision, and `import-recon` wants to see it either way.
    const read = toSourcePresentation(
      presentation({
        slides: [
          { objectId: 's1', pageElements: [] },
          {
            objectId: 's2',
            pageElements: [],
            slideProperties: { isSkipped: true },
          },
        ],
      }),
    )
    expect(read.slides[0]!.skipped).toBeUndefined()
    expect(read.slides[1]!.skipped).toBe(true)
  })

  it('is not marked when the deck says it is presented', () => {
    // `isSkipped: false` is what Google sends for an ordinary page, and it
    // must read the same as saying nothing.
    const read = toSourcePresentation(
      presentation({
        slides: [
          {
            objectId: 's1',
            pageElements: [],
            slideProperties: { isSkipped: false, layoutObjectId: 'l1' },
          },
        ],
      }),
    )
    expect(read.slides[0]!.skipped).toBeUndefined()
  })
})
