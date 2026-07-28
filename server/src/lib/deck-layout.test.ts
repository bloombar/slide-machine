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
