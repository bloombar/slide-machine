/**
 * Unit tests for the shared slide-layout model: each layout type produces the
 * arrangement the app's viewer uses — centered title/section/quote, left text
 * for content/list with NO image, a dominant image for image-heavy, and text +
 * image for two-column.
 */
import { describe, it, expect } from 'vitest'
import { computeLayout } from './deck-layout'
import type { ExportSlide } from './deck-yaml'

const slide = (over: Partial<ExportSlide>): ExportSlide => ({
  layoutType: 'content',
  ...over,
})

const kinds = (s: ExportSlide) => computeLayout(s).map(b => b.kind)
const textRuns = (s: ExportSlide) =>
  computeLayout(s)
    .filter(b => b.kind === 'text')
    .flatMap(b => (b.kind === 'text' ? b.runs.map(r => r.text) : []))

describe('computeLayout', () => {
  it('title: centered, no image, with caption', () => {
    const boxes = computeLayout(
      slide({ layoutType: 'title', title: 'Hi', caption: 'sub' }),
    )
    expect(boxes.every(b => b.kind !== 'image')).toBe(true)
    const t = boxes.find(b => b.kind === 'text')
    expect(t?.kind === 'text' && t.align).toBe('center')
    expect(t?.kind === 'text' && t.valign).toBe('middle')
    expect(
      textRuns(slide({ layoutType: 'title', title: 'Hi', caption: 'sub' })),
    ).toEqual(['Hi', 'sub'])
  })

  it('image-heavy: has an image box and NO title/body text (just caption)', () => {
    const s = slide({
      layoutType: 'image-heavy',
      title: 'New slide',
      body: 'Click to edit',
      imageRef: 'https://img/x',
      caption: 'a caption',
    })
    expect(kinds(s)).toContain('image')
    // The stray title/body are not rendered — only the caption.
    expect(textRuns(s)).toEqual(['a caption'])
  })

  it('content and list: left text, no image (even if the slide has one)', () => {
    for (const layoutType of ['content', 'list'] as const) {
      const s = slide({
        layoutType,
        title: 'T',
        bullets: ['a', 'b'],
        imageRef: 'https://img/x',
      })
      expect(kinds(s)).not.toContain('image')
      const t = computeLayout(s).find(b => b.kind === 'text')
      expect(t?.kind === 'text' && t.align).toBe('left')
    }
  })

  it('embeds the image attribution/license in the footer (IMG-5)', () => {
    const s = slide({
      layoutType: 'image-heavy',
      imageRef: 'https://img/x',
      caption: 'A leaf',
      attribution: {
        creator: 'Ada',
        sourceName: 'Openverse',
        license: 'CC BY 4.0',
      },
    })
    const footer = textRuns(s).join(' ')
    expect(footer).toContain('A leaf')
    expect(footer).toContain('by Ada')
    expect(footer).toContain('CC BY 4.0')
  })

  it('two-column: text plus an image box', () => {
    const s = slide({
      layoutType: 'two-column',
      title: 'T',
      body: 'b',
      imageRef: 'https://img/x',
    })
    expect(kinds(s)).toContain('text')
    expect(kinds(s)).toContain('image')
  })

  it('section: an accent rule plus a centered title', () => {
    const s = slide({ layoutType: 'section', title: 'Part 2' })
    expect(kinds(s)).toContain('rule')
    expect(textRuns(s)).toEqual(['Part 2'])
  })

  it('unknown layout: title + body, with an image only when present', () => {
    expect(kinds(slide({ layoutType: 'mystery', title: 'T' }))).not.toContain(
      'image',
    )
    expect(
      kinds(
        slide({ layoutType: 'mystery', title: 'T', imageRef: 'https://i' }),
      ),
    ).toContain('image')
  })
})

/**
 * A template that arranged a layout exports from its own boxes (TMPL-4), so a
 * PDF matches the screen. A layout with no arrangement keeps the hand-tuned
 * one below — that is what every built-in relies on.
 */
describe('an arranged layout', () => {
  const arranged = {
    type: 'two-photos',
    label: 'Two photos',
    purpose: 'Two pictures side by side',
    slots: [
      { name: 'heading', kind: 'text' as const, label: 'Heading' },
      { name: 'photo-left', kind: 'image' as const, label: 'Left' },
      { name: 'photo-right', kind: 'image' as const, label: 'Right' },
    ],
    elementPositions: {
      heading: { x: 0.05, y: 0.05, w: 0.9, h: 0.15, fontSize: 6 },
      'photo-left': { x: 0.05, y: 0.25, w: 0.42, h: 0.6 },
      'photo-right': { x: 0.53, y: 0.25, w: 0.42, h: 0.6 },
    },
  }

  const slide = {
    layoutType: 'two-photos',
    slots: {
      heading: { kind: 'text' as const, value: 'Two suns' },
      'photo-left': { kind: 'image' as const, ref: 'http://a.png' },
      'photo-right': { kind: 'image' as const, ref: 'http://b.png' },
    },
  }

  it('draws every box the template placed, where it placed it', () => {
    const boxes = computeLayout(slide, arranged)
    expect(boxes).toHaveLength(3)
    expect(boxes[1]).toMatchObject({ kind: 'image', x: 0.05, w: 0.42 })
    expect(boxes[2]).toMatchObject({ kind: 'image', x: 0.53, w: 0.42 })
  })

  it('carries a box’s type size across, as a fraction of the width', () => {
    const [heading] = computeLayout(slide, arranged)
    // 6cqi is 6% of the slide width, and the export measures type the same way
    expect(heading).toMatchObject({ kind: 'text' })
    expect(
      (heading as { runs: { sizeFrac: number }[] }).runs[0]!.sizeFrac,
    ).toBe(0.06)
  })

  it('leaves out a box whose slot the slide never filled', () => {
    const boxes = computeLayout(
      { layoutType: 'two-photos', slots: {} },
      arranged,
    )
    // The pictures still reserve their space; the empty heading does not
    expect(boxes.every(b => b.kind === 'image')).toBe(true)
  })

  it('keeps the hand-tuned arrangement when the layout has no boxes', () => {
    const plain = { ...arranged, elementPositions: {} }
    expect(computeLayout({ layoutType: 'content', title: 'T' }, plain)).toEqual(
      computeLayout({ layoutType: 'content', title: 'T' }),
    )
  })
})

describe('a layout that carries its tree', () => {
  /** The conventional title layout as every template has it: a centred column
   * holding a title and a caption. */
  const titleTree = {
    id: 'root',
    container: {
      mode: 'flex' as const,
      direction: 'column' as const,
      justify: 'center' as const,
      alignItems: 'center' as const,
      gap: 2,
    },
    children: [
      {
        id: 'title',
        slot: 'title',
        style: { textStyle: 'title', align: 'center' as const },
      },
      {
        id: 'caption',
        slot: 'caption',
        style: { textStyle: 'caption', align: 'center' as const },
      },
    ],
  }

  /** The same layout as the editor stored it: boxes measured around the
   * PREVIEW's sample text, which a centred container shrinks to fit. */
  const layout = {
    type: 'title',
    label: 'Title',
    purpose: 'opening slide',
    slots: [
      { name: 'title', kind: 'text' as const, label: 'Title' },
      { name: 'caption', kind: 'text' as const, label: 'Caption' },
    ],
    tree: titleTree,
    elementPositions: {
      title: { x: 0.196, y: 0.106, w: 0.582, h: 0.055, fontSize: 6.8 },
      caption: { x: 0.443, y: 0.171, w: 0.087, h: 0.016, fontSize: 2 },
    },
  }

  const slide = {
    layoutType: 'title',
    slots: {
      title: { kind: 'text' as const, value: 'Rainwater Harvesting' },
      caption: {
        kind: 'text' as const,
        value: 'Understanding the environmental and practical impacts',
      },
    },
  }

  it('draws the arrangement rather than the measurement', () => {
    // The bug this guards: a real lecture's caption drawn in a box measured
    // around a three-word sample wraps one word per line, over the title
    const [title, caption] = computeLayout(slide, layout)
    expect(title).toMatchObject({ x: 0.06, w: 0.88 })
    expect(caption).toMatchObject({ x: 0.06, w: 0.88 })
    expect(caption!.y).toBeGreaterThan(title!.y + title!.h)
  })

  it('sizes a box around the words it actually holds', () => {
    const short = computeLayout(
      { layoutType: 'title', slots: { title: slide.slots.title } },
      layout,
    )
    const long = computeLayout(
      {
        layoutType: 'title',
        slots: {
          title: { kind: 'text' as const, value: 'Rainwater '.repeat(12) },
        },
      },
      layout,
    )
    // What the browser does on screen, and what a frozen measurement cannot
    expect(long[0]!.h).toBeGreaterThan(short[0]!.h)
  })

  it('takes the type from the style the box follows', () => {
    const [title] = computeLayout(slide, layout)
    // 7cqi is the title role's size; the measurement said 6.8 for the sample
    expect(
      (title as { runs: { sizeFrac: number }[] }).runs[0]!.sizeFrac,
    ).toBeCloseTo(0.07, 3)
  })

  it('follows the template’s own margins', () => {
    const [title] = computeLayout(slide, layout, { marginX: 0.2 })
    expect(title!.x).toBeCloseTo(0.2, 3)
  })

  it('falls back to the measurement for a design with no tree', () => {
    // An imported design is absolute geometry and nothing else (TMPL-8)
    const imported = { ...layout, tree: undefined }
    const [title] = computeLayout(slide, imported)
    expect(title).toMatchObject({ x: 0.196, w: 0.582 })
  })

  it('leaves out a box whose slot the slide never filled', () => {
    // A picture reserves its space because the design reserved it; an empty
    // text box would be a hole where the audience saw nothing
    const boxes = computeLayout(
      { layoutType: 'title', slots: { title: slide.slots.title } },
      layout,
    )
    expect(boxes).toHaveLength(1)
  })

  it('reads the tree even when nothing was ever measured', () => {
    // Which is every built-in: the editor writes geometry only for a layout
    // whose tab someone opened, so most templates carry none at all
    const unmeasured = { ...layout, elementPositions: {} }
    const [title] = computeLayout(slide, unmeasured)
    expect(title).toMatchObject({ x: 0.06, w: 0.88 })
  })
})

/**
 * Where the rule actually lives (EXP-7).
 *
 * "Rendered in every export format, not emitted as raw markup" is decided
 * here, once: a formula and a table become boxes of their own, and no
 * exporter is given the option of writing their source out as text. Testing
 * it at this level states the rule rather than testing each format's
 * consequence of it.
 */
describe('specialized content in the export model', () => {
  const layout = {
    type: 'lab',
    label: 'Lab',
    purpose: 'a worked example',
    slots: [
      { name: 'eq', kind: 'math' as const, label: 'Equation' },
      { name: 'sample', kind: 'code' as const, label: 'Sample' },
      { name: 'data', kind: 'table' as const, label: 'Data' },
      { name: 'fixed', kind: 'preformatted' as const, label: 'Diagram' },
    ],
    elementPositions: {
      eq: { x: 0.06, y: 0.06, w: 0.88, h: 0.2 },
      sample: { x: 0.06, y: 0.3, w: 0.42, h: 0.3, fontSize: 2 },
      data: { x: 0.52, y: 0.3, w: 0.42, h: 0.3 },
      fixed: { x: 0.06, y: 0.66, w: 0.88, h: 0.2, fontSize: 2 },
    },
  }

  const slide = {
    layoutType: 'lab',
    slots: {
      eq: { kind: 'math' as const, tex: '\\frac{1}{2}gt^2' },
      sample: {
        kind: 'code' as const,
        source: 'def f(x):\n    return x',
        language: 'python',
      },
      data: {
        kind: 'table' as const,
        header: ['Year'],
        rows: [['2024'], ['2025']],
      },
      fixed: { kind: 'preformatted' as const, value: 'a   b' },
    },
  }

  const boxes = () => computeLayout(slide, layout)
  const allText = () =>
    boxes()
      .flatMap(b => (b.kind === 'text' ? b.runs.map(r => r.text) : []))
      .join('\n')

  it('makes a formula a box of its own, carrying its source to be typeset', () => {
    const math = boxes().find(b => b.kind === 'math')
    expect(math).toMatchObject({ tex: '\\frac{1}{2}gt^2', slot: 'eq' })
  })

  it('never lets a formula become text', () => {
    // The prohibition, at the only place that could break it
    expect(allText()).not.toContain('frac')
  })

  it('makes a table a box of its own, rows and header intact', () => {
    expect(boxes().find(b => b.kind === 'table')).toMatchObject({
      header: ['Year'],
      rows: [['2024'], ['2025']],
    })
  })

  it('carries the proportions a table was given', () => {
    // The exporters divide the box with these (EDIT-7); dropping them here
    // would leave every export re-dividing the table equally.
    const boxes = computeLayout(
      {
        layoutType: 'lab',
        slots: {
          data: {
            kind: 'table',
            rows: [['2024']],
            colWidths: [0.3, 0.7],
            rowHeights: [1],
          },
        },
      } as never,
      layout,
    )
    expect(boxes.find(b => b.kind === 'table')).toMatchObject({
      colWidths: [0.3, 0.7],
      rowHeights: [1],
    })
  })

  it('never lets a table become lines of text', () => {
    expect(allText()).not.toContain('2024')
  })

  it('splits a listing into coloured, monospaced runs', () => {
    const code = boxes().find(
      b => b.kind === 'text' && b.slot === 'sample',
    ) as { runs: { text: string; mono?: boolean; hex?: string }[] }
    expect(code.runs.every(r => r.mono)).toBe(true)
    expect(code.runs.some(r => r.hex)).toBe(true)
    // And the runs are the listing, character for character
    expect(code.runs.map(r => r.text).join('')).toContain('    return x')
  })

  it('keeps preformatted text monospaced and unreflowed', () => {
    const pre = boxes().find(b => b.kind === 'text' && b.slot === 'fixed') as {
      runs: { text: string; mono?: boolean }[]
    }
    expect(pre.runs[0]).toMatchObject({ text: 'a   b', mono: true })
  })
})
