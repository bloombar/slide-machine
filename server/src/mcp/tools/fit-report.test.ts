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
  it('returns nothing when the template could not be read at all — silent, like the rest of this surface', () => {
    expect(fitIssues('slide-1', { title: 'x' }, 'list', undefined)).toEqual([])
  })

  it('returns nothing when every written field fits', () => {
    expect(
      fitIssues(
        'slide-1',
        { title: 'On budget', bullets: ['a', 'b'] },
        'list',
        [list],
      ),
    ).toEqual([])
  })

  it('returns nothing when nothing was actually written', () => {
    expect(fitIssues('slide-1', {}, 'list', [list])).toEqual([])
  })

  it('flags a field the layout does not declare as undrawn, naming only the boxes this surface can write', () => {
    // figure and label are real boxes on big-number, but neither is a
    // conventional field add_slide/add_slides/edit_slides can address —
    // naming them would send a model to try writing them and get nowhere.
    const issues = fitIssues(
      'slide-1',
      { title: 'x', body: 'y' },
      'big-number',
      [bigNumber],
    )
    expect(issues).toEqual([
      expect.objectContaining({ field: 'title', issue: 'undrawn' }),
      expect.objectContaining({ field: 'body', issue: 'undrawn' }),
    ])
    expect(issues[0]!.message).toContain(
      'The boxes this tool can write on the "big-number" layout are: caption.',
    )
    expect(issues[0]!.message).toContain(
      'Its other boxes (figure, label) must be filled in the app.',
    )
    expect(issues[0]!.message).not.toContain('Its boxes are: figure')
  })

  it('does not claim other boxes exist when every box on the layout is writable', () => {
    // `body` is not declared (undrawn fires), and the layout's only real box
    // ("title") is itself writable, so there is no "other boxes" clause.
    const issues = fitIssues('slide-1', { body: 'x' }, 'list', [
      { ...list, slots: [{ name: 'title', kind: 'text', label: 'Title' }] },
    ])
    expect(issues[0]!.message).toContain(
      'The boxes this tool can write on the "list" layout are: title.',
    )
    expect(issues[0]!.message).not.toContain('must be filled in the app')
  })

  it('flags text over its box budget with used and allowed', () => {
    const issues = fitIssues('slide-1', { title: 'A'.repeat(50) }, 'list', [
      list,
    ])
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
    const issues = fitIssues('slide-1', { bullets }, 'list', [list])
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
    const issues = fitIssues('slide-1', { bullets: ['a'] }, 'big-number', [
      bigNumber,
    ])
    expect(issues).toEqual([
      expect.objectContaining({ field: 'bullets', issue: 'undrawn' }),
    ])
  })

  it('trims surrounding whitespace before counting, like the box will show', () => {
    const issues = fitIssues(
      'slide-1',
      { title: `  ${'A'.repeat(44)}  ` },
      'list',
      [list],
    )
    expect(issues).toEqual([])
  })

  it('skips a field cleared back to empty — clearing is not writing it', () => {
    expect(
      fitIssues('slide-1', { title: '' }, 'big-number', [bigNumber]),
    ).toEqual([])
    expect(fitIssues('slide-1', { bullets: [] }, 'list', [list])).toEqual([])
  })

  describe('whiteboard', () => {
    // MUST-FIX: layoutDescriptors excludes whiteboard on purpose (GEN-6), so
    // a slide already on it must be recognised WITHOUT looking it up there —
    // that lookup returning nothing is exactly what made this the one case
    // the old check always missed, on the layout with the strongest claim to
    // catching it (zero text boxes, so every field written is undrawn).
    it('flags every written field as undrawn, needing no template at all', () => {
      const issues = fitIssues(
        'slide-1',
        { title: 'x', bullets: ['a', 'b'] },
        'whiteboard',
        undefined,
      )
      expect(issues).toEqual([
        expect.objectContaining({ field: 'title', issue: 'undrawn' }),
        expect.objectContaining({ field: 'bullets', issue: 'undrawn' }),
      ])
      expect(issues[0]!.message).toContain(
        'this slide is on the "whiteboard" layout, a manual drawing canvas with no text boxes at all',
      )
    })

    it('still flags every field when a template IS available', () => {
      const issues = fitIssues('slide-1', { title: 'x' }, 'whiteboard', [
        list,
        bigNumber,
      ])
      expect(issues).toEqual([
        expect.objectContaining({ field: 'title', issue: 'undrawn' }),
      ])
    })
  })

  describe('unresolvable layout', () => {
    // Distinct from whiteboard and from "template unreadable": the template
    // WAS read, but this layoutType simply isn't in it (renamed, removed, or
    // a slide left over from a different template) — silence here would read
    // as "it fit", which is exactly the defect this whole module exists to
    // remove.
    it('reports that the check could not run, rather than staying silent', () => {
      const issues = fitIssues('slide-1', { title: 'x' }, 'made-up', [list])
      expect(issues).toEqual([
        expect.objectContaining({ slideId: 'slide-1', issue: 'unchecked' }),
      ])
      expect(issues[0]!.message).toContain(
        'Fit check could not run for this slide: the "made-up" layout was not found',
      )
    })

    it('reports nothing when nothing was actually written to the unresolvable layout', () => {
      expect(fitIssues('slide-1', {}, 'made-up', [list])).toEqual([])
    })
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
