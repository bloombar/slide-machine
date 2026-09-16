/**
 * Unit tests for the fit-check helper (MCP layout truth) — pure, so the
 * arithmetic is tested directly here; slides.test.ts covers the wiring
 * (that add_slide/add_slides/edit_slides actually call this against the
 * real template a lecture's deck.get answers with).
 */
import { describe, expect, it } from 'vitest'
import type { LayoutDescriptor } from '@slide-machine/shared'
import { fitIssues, fitReportText } from './fit-report'

const bigNumber: LayoutDescriptor = {
  type: 'big-number',
  label: 'Big number',
  purpose: 'One figure the slide exists to frame',
  slots: [
    { name: 'figure', kind: 'text', label: 'Figure', maxChars: 8 },
    { name: 'label', kind: 'text', label: 'Label', maxChars: 60 },
    { name: 'caption', kind: 'text', label: 'Caption', maxChars: 120 },
  ],
}

const list: LayoutDescriptor = {
  type: 'list',
  label: 'Bullet list',
  purpose: 'Points under a title',
  slots: [
    { name: 'title', kind: 'text', label: 'Title', maxChars: 44 },
    {
      name: 'bullets',
      kind: 'bullets',
      label: 'Bullets',
      maxItems: 5,
      maxChars: 70,
    },
  ],
}

describe('fitIssues', () => {
  it('returns nothing when the layout is unknown — nothing to check against', () => {
    expect(fitIssues('slide-1', { title: 'x' }, undefined)).toEqual([])
  })

  it('returns nothing when every written field fits', () => {
    expect(
      fitIssues('slide-1', { title: 'On budget', bullets: ['a', 'b'] }, list),
    ).toEqual([])
  })

  it('flags a field the layout does not declare as undrawn, naming the boxes it does have', () => {
    const issues = fitIssues('slide-1', { title: 'x', body: 'y' }, bigNumber)
    expect(issues).toEqual([
      expect.objectContaining({ field: 'title', issue: 'undrawn' }),
      expect.objectContaining({ field: 'body', issue: 'undrawn' }),
    ])
    expect(issues[0]!.message).toContain(
      'Its boxes are: figure, label, caption.',
    )
  })

  it('flags text over its box budget with used and allowed', () => {
    const issues = fitIssues('slide-1', { title: 'A'.repeat(50) }, list)
    expect(issues).toEqual([
      {
        slideId: 'slide-1',
        field: 'title',
        issue: 'over-budget',
        used: 50,
        allowed: 44,
        message: expect.stringContaining('50 used, 44 allowed'),
      },
    ])
  })

  it('flags a bullet list over its item count and a bullet over its character budget', () => {
    const bullets = ['a', 'b', 'c', 'd', 'e', 'Z'.repeat(80)]
    const issues = fitIssues('slide-1', { bullets }, list)
    expect(issues).toEqual([
      expect.objectContaining({
        field: 'bullets',
        issue: 'over-budget',
        used: 6,
        allowed: 5,
      }),
      expect.objectContaining({
        field: 'bullets[5]',
        issue: 'over-budget',
        used: 80,
        allowed: 70,
      }),
    ])
  })

  it('flags bullets themselves as undrawn when the layout has no bullets box', () => {
    const issues = fitIssues('slide-1', { bullets: ['a'] }, bigNumber)
    expect(issues).toEqual([
      expect.objectContaining({ field: 'bullets', issue: 'undrawn' }),
    ])
  })

  it('trims surrounding whitespace before counting, like the box will show', () => {
    const issues = fitIssues(
      'slide-1',
      { title: `  ${'A'.repeat(44)}  ` },
      list,
    )
    expect(issues).toEqual([])
  })
})

describe('fitReportText', () => {
  it('is undefined for no issues, so a clean write does not grow the result', () => {
    expect(fitReportText([])).toBeUndefined()
  })

  it('names the slide for every issue, for a multi-slide batch', () => {
    const text = fitReportText([
      {
        slideId: 'slide-2',
        field: 'title',
        issue: 'undrawn',
        message: 'boom',
      },
    ])
    expect(text).toContain('slide-2: boom')
  })
})
