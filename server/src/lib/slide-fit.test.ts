/**
 * Unit tests for slide capacity enforcement: overflowing updates are
 * detected, new-slide content clamps to the layout's character
 * budgets (word-boundary cuts for spaced text, hard cuts for CJK),
 * and promoted updates get a synthesized title.
 */
import { describe, it, expect } from 'vitest'
import type {
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'
import {
  charCount,
  clampToBudget,
  titleFromPhrase,
  updateOverflows,
} from './slide-fit'

const descriptors: LayoutDescriptor[] = [
  {
    type: 'list',
    label: 'Bullet list',
    purpose: 'points',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      { name: 'bullets', kind: 'bullets', label: 'Slide bullets' },
    ],
    constraints: { maxBullets: 3, maxBulletChars: 20, maxTitleChars: 25 },
  },
  {
    type: 'content',
    label: 'Content',
    purpose: 'general',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      // Per-slot validation (the WYSIWYG form) overrides layout budgets
      { name: 'body', kind: 'text', label: 'Slide body', maxChars: 40 },
    ],
    constraints: { maxTitleChars: 25 },
  },
]

const result = (
  overrides: Partial<SlideGenerationResult>,
): SlideGenerationResult => ({
  action: 'update',
  layoutType: 'list',
  slots: {},
  ...overrides,
})

describe('updateOverflows', () => {
  it('flags bullet overflow against the target layout', () => {
    const r = result({ slots: { bullets: ['one more'] } })
    expect(
      updateOverflows(r, { bulletCount: 3, bodyChars: 0 }, descriptors),
    ).toBe(true)
    expect(
      updateOverflows(r, { bulletCount: 2, bodyChars: 0 }, descriptors),
    ).toBe(false)
  })

  it('flags body character overflow', () => {
    const r = result({
      layoutType: 'content',
      // 28 chars: overflows a 40-char budget once 20 are used, not 5
      slots: { body: 'six more words of body text.' },
    })
    expect(
      updateOverflows(r, { bulletCount: 0, bodyChars: 20 }, descriptors),
    ).toBe(true)
    expect(
      updateOverflows(r, { bulletCount: 0, bodyChars: 5 }, descriptors),
    ).toBe(false)
  })

  it('never flags non-update actions or unconstrained layouts', () => {
    expect(
      updateOverflows(
        result({ action: 'new', slots: { bullets: ['x'] } }),
        { bulletCount: 99, bodyChars: 999 },
        descriptors,
      ),
    ).toBe(false)
  })
})

describe('clampToBudget', () => {
  it('truncates every slot to its character budget at a word boundary', () => {
    const clamped = clampToBudget(
      result({
        action: 'new',
        layoutType: 'list',
        slots: {
          title: 'a very long slide title with too many words',
          bullets: [
            'short one',
            'this bullet has far too many words in it',
            'three',
            'four',
            'five is over the bullet cap',
          ],
        },
      }),
      descriptors,
    )
    // 25-char title budget, cut at the last space inside it
    expect(clamped.slots.title).toBe('a very long slide title…')
    expect(clamped.slots.bullets).toHaveLength(3)
    // 20-char bullet budget
    expect(clamped.slots.bullets![1]).toBe('this bullet has far…')
  })

  it('hard-cuts unspaced text (CJK) at the budget', () => {
    // 28 chars, no spaces — nothing word-based could measure this
    const zh = '光合作用是植物利用光能把二氧化碳和水合成有机物的过程机制'
    const clamped = clampToBudget(
      result({ action: 'new', layoutType: 'content', slots: { title: zh } }),
      descriptors,
    )
    // 25-char title budget with no space to cut at
    expect(clamped.slots.title).toBe(`${zh.slice(0, 25)}…`)
  })

  it('leaves content within budget untouched', () => {
    const r = result({
      action: 'new',
      layoutType: 'content',
      slots: { title: 'Short', body: 'Fits fine.' },
    })
    expect(clampToBudget(r, descriptors).slots).toEqual(r.slots)
  })
})

describe('per-slot budgets (WYSIWYG form)', () => {
  it('slot-level maxChars overrides the layout constraint', () => {
    // content layout: body budget comes from the SLOT (40 chars),
    // title from the layout constraint (25 chars)
    const clamped = clampToBudget(
      result({
        action: 'new',
        layoutType: 'content',
        slots: {
          title: 'one two three four five six',
          body: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12',
        },
      }),
      descriptors,
    )
    expect(clamped.slots.title).toBe('one two three four five…')
    expect(clamped.slots.body!.length).toBeLessThanOrEqual(40)

    // updateOverflows consults the same merged budgets
    expect(
      updateOverflows(
        result({ layoutType: 'content', slots: { body: 'twelve chars' } }),
        { bulletCount: 0, bodyChars: 30 },
        descriptors,
      ),
    ).toBe(true)
  })
})

describe('a box’s own limits (TMPL-10)', () => {
  /** A layout whose body box is limited the way an author would state it. */
  const withBody = (spec: Record<string, unknown>): LayoutDescriptor[] => [
    {
      type: 'content',
      label: 'Content',
      purpose: 'body',
      slots: [
        { name: 'title', kind: 'text', label: 'Slide title' },
        { name: 'body', kind: 'text', label: 'Slide body', ...spec },
      ],
    } as LayoutDescriptor,
  ]

  const body = (limits: Record<string, unknown>, text: string) =>
    clampToBudget(
      result({ action: 'new', layoutType: 'content', slots: { body: text } }),
      withBody(limits),
    ).slots.body!

  it('honours a ceiling stated in words', () => {
    // Authors think about prose in words; the system converts and trims
    const trimmed = body({ maxWords: 3 }, 'one two three four five six seven')
    expect(trimmed.length).toBeLessThan(
      'one two three four five six seven'.length,
    )
    expect(trimmed).toContain('one two three')
  })

  it('takes the tighter of a word and a character ceiling', () => {
    const long = 'alpha bravo charlie delta echo foxtrot golf hotel india'
    // 3 words is tighter than 200 chars, so 3 words wins
    const byWords = body({ maxWords: 3, maxChars: 200 }, long)
    // ...and 10 chars is tighter than 50 words, so the chars win
    const byChars = body({ maxWords: 50, maxChars: 10 }, long)
    expect(byWords.length).toBeLessThan(long.length)
    expect(byChars.length).toBeLessThanOrEqual(11)
  })

  it('leaves content alone when it is within both', () => {
    expect(body({ maxWords: 20, maxChars: 200 }, 'short enough')).toBe(
      'short enough',
    )
  })

  it('holds the limit whatever the model returned', () => {
    // The point of TMPL-10: instructions steer the model, limits bind it
    const over = body({ maxChars: 12 }, 'x'.repeat(500))
    expect(over.length).toBeLessThanOrEqual(13)
  })
})

describe('helpers', () => {
  it('counts characters and synthesizes titles from phrases', () => {
    expect(charCount('  one two   three ')).toBe(15)
    expect(charCount('光合作用')).toBe(4)
    expect(charCount(undefined)).toBe(0)
    expect(titleFromPhrase('and they also need minerals from the soil')).toBe(
      'And They Also Need Minerals From',
    )
  })
})

/**
 * Limits on the boxes a template's author named (GEN-11).
 *
 * "Fitting respects the kind" is the whole of it: prose may be trimmed at a
 * word boundary, because a shortened sentence is still a sentence. A program
 * listing or a formula may not, because a half expression does not parse and
 * a listing cut mid-line no longer runs. A half-formula is worse than none.
 */
describe('limits on an authored box', () => {
  const descriptors = (
    slots: LayoutDescriptor['slots'],
  ): LayoutDescriptor[] => [
    { type: 'lab', label: 'Lab', purpose: 'a worked example', slots },
  ]

  const result = (declared: SlideGenerationResult['declared']) =>
    ({
      action: 'new',
      layoutType: 'lab',
      slots: {},
      declared,
    }) as SlideGenerationResult

  it('trims prose at a word boundary', () => {
    const fitted = clampToBudget(
      result({ note: { kind: 'text', value: 'one two three four five' } }),
      descriptors([{ name: 'note', kind: 'text', label: 'Note', maxWords: 3 }]),
    )
    expect(fitted.declared?.note).toEqual({
      kind: 'text',
      value: 'one two three',
    })
  })

  it('omits a listing that will not fit rather than cutting it', () => {
    // A listing truncated mid-line no longer runs; the box is left empty and
    // the lecturer can put a shorter one in it
    const fitted = clampToBudget(
      result({
        sample: {
          kind: 'code',
          source: 'def f():\n    return 1',
          language: 'python',
        },
      }),
      descriptors([
        { name: 'sample', kind: 'code', label: 'Sample', maxChars: 5 },
      ]),
    )
    expect(fitted.declared?.sample).toBeUndefined()
  })

  it('keeps a listing that fits, exactly as written', () => {
    const source = 'def f():\n    return 1'
    const fitted = clampToBudget(
      result({ sample: { kind: 'code', source, language: 'python' } }),
      descriptors([
        { name: 'sample', kind: 'code', label: 'Sample', maxChars: 200 },
      ]),
    )
    expect(fitted.declared?.sample).toEqual({
      kind: 'code',
      source,
      language: 'python',
    })
  })

  it('omits a formula that will not fit rather than cutting it', () => {
    const fitted = clampToBudget(
      result({ eq: { kind: 'math', tex: '\\int_0^\\infty e^{-x^2} dx' } }),
      descriptors([
        { name: 'eq', kind: 'math', label: 'Equation', maxChars: 5 },
      ]),
    )
    expect(fitted.declared?.eq).toBeUndefined()
  })

  it('bounds a table by rows, not by characters', () => {
    // Cutting a row keeps a grid a grid; cutting a cell mid-word would leave
    // a column of fragments
    const fitted = clampToBudget(
      result({
        data: {
          kind: 'table',
          header: ['Year'],
          rows: [['2023'], ['2024'], ['2025']],
        },
      }),
      descriptors([
        { name: 'data', kind: 'table', label: 'Data', maxItems: 2 },
      ]),
    )
    expect(fitted.declared?.data).toMatchObject({
      rows: [['2023'], ['2024']],
    })
  })

  it('bounds a list by its own item ceiling', () => {
    const fitted = clampToBudget(
      result({
        points: { kind: 'bullets', items: ['a', 'b', 'c', 'd'] },
      }),
      descriptors([
        { name: 'points', kind: 'bullets', label: 'Points', maxItems: 2 },
      ]),
    )
    expect(fitted.declared?.points).toEqual({
      kind: 'bullets',
      items: ['a', 'b'],
    })
  })

  it('drops a box the layout it ended up on does not declare', () => {
    // Image reconciliation can move a slide to a layout that can hold its
    // picture (GEN-7), after the content was checked against the old one. A
    // slide is never left holding something its template has no box for.
    const fitted = clampToBudget(
      {
        action: 'new',
        layoutType: 'two-column',
        slots: {},
        declared: { eq: { kind: 'math', tex: 'v = gt' } },
      } as SlideGenerationResult,
      [
        ...descriptors([{ name: 'eq', kind: 'math', label: 'Equation' }]),
        {
          type: 'two-column',
          label: 'Two column',
          purpose: 'text beside a picture',
          slots: [{ name: 'body', kind: 'text', label: 'Body' }],
        },
      ],
    )
    expect(fitted.declared).toBeUndefined()
  })

  it('leaves a box the template set no limit on alone', () => {
    const long = 'x'.repeat(500)
    const fitted = clampToBudget(
      result({ note: { kind: 'text', value: long } }),
      descriptors([{ name: 'note', kind: 'text', label: 'Note' }]),
    )
    expect(fitted.declared?.note).toEqual({ kind: 'text', value: long })
  })
})

describe('an authored box that will not fit', () => {
  const specs = [
    { name: 'sample', kind: 'code' as const, label: 'Sample', maxChars: 10 },
    { name: 'points', kind: 'bullets' as const, label: 'Points', maxItems: 2 },
  ]
  const descriptors: LayoutDescriptor[] = [
    { type: 'lab', label: 'Lab', purpose: 'a worked example', slots: specs },
  ]
  const update = (declared: SlideGenerationResult['declared']) =>
    ({
      action: 'update',
      layoutType: 'lab',
      slots: {},
      declared,
    }) as SlideGenerationResult
  const empty = { bulletCount: 0, bodyChars: 0 }

  it('spills onto a new slide rather than being cut down', () => {
    // "Moved or omitted whole": moved first, because a listing that will not
    // fit here may fit on a slide of its own
    expect(
      updateOverflows(
        update({
          sample: { kind: 'code', source: 'def f():\n    return 1' },
        }),
        empty,
        descriptors,
      ),
    ).toBe(true)
  })

  it('does not spill when it fits', () => {
    expect(
      updateOverflows(
        update({ sample: { kind: 'code', source: 'x = 1' } }),
        empty,
        descriptors,
      ),
    ).toBe(false)
  })

  it('counts a list by its items', () => {
    expect(
      updateOverflows(
        update({ points: { kind: 'bullets', items: ['a', 'b', 'c'] } }),
        empty,
        descriptors,
      ),
    ).toBe(true)
  })

  it('says nothing about a box the template set no limit on', () => {
    const unlimited: LayoutDescriptor[] = [
      {
        type: 'lab',
        label: 'Lab',
        purpose: 'a worked example',
        slots: [{ name: 'sample', kind: 'code', label: 'Sample' }],
      },
    ]
    expect(
      updateOverflows(
        update({ sample: { kind: 'code', source: 'x'.repeat(900) } }),
        empty,
        unlimited,
      ),
    ).toBe(false)
  })
})
