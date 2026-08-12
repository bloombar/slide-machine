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
