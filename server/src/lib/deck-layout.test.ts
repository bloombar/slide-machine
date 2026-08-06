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
