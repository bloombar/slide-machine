/**
 * Unit tests for checking what the model wrote against what the layout
 * declares (GEN-11).
 *
 * Every test here is the system refusing to trust a reply. The model is asked
 * for a shape; what arrives is treated as input, and the three rules — discard
 * what is not declared, coerce only where unambiguous, and offer a specialized
 * kind only where a template asked for one — are what stand between a slide
 * and something its template has no box for.
 */
import { describe, it, expect } from 'vitest'
import type { LayoutDescriptor } from '@slide-machine/shared'
import {
  declaredContentOf,
  hasContent,
  onlyDeclaredBy,
  splitGeneratedSlots,
} from './generated-slots'

const layout = (
  slots: LayoutDescriptor['slots'],
  type = 'lab',
): LayoutDescriptor[] => [
  { type, label: 'Lab', purpose: 'a worked example', slots },
]

const CONVENTIONAL = layout([
  { name: 'title', kind: 'text', label: 'Title' },
  { name: 'body', kind: 'text', label: 'Body' },
  { name: 'bullets', kind: 'bullets', label: 'Points' },
  { name: 'caption', kind: 'text', label: 'Caption' },
])

const AUTHORED = layout([
  { name: 'title', kind: 'text', label: 'Title' },
  {
    name: 'example',
    kind: 'code',
    label: 'Worked example',
    options: { language: 'python' },
  },
  { name: 'eq', kind: 'math', label: 'Equation' },
  { name: 'data', kind: 'table', label: 'Data' },
  { name: 'figure', kind: 'image', label: 'Figure' },
])

describe('content for boxes the layout declares', () => {
  it('keeps the conventional four in their own place', () => {
    const split = splitGeneratedSlots(
      {
        title: 'Falling bodies',
        body: 'An overview',
        bullets: ['One', 'Two'],
        caption: 'A barrel',
      },
      'lab',
      CONVENTIONAL,
    )
    expect(split).toMatchObject({
      title: 'Falling bodies',
      body: 'An overview',
      bullets: ['One', 'Two'],
      caption: 'A barrel',
    })
    expect(split.declared).toEqual({})
  })

  it('shapes each authored box the way its kind calls for', () => {
    const split = splitGeneratedSlots(
      {
        title: 'Falling bodies',
        example: 'def f():\n    return 1',
        eq: 'v = gt',
        data: { header: ['Year'], rows: [['2024'], ['2025']] },
      },
      'lab',
      AUTHORED,
    )
    expect(split.title).toBe('Falling bodies')
    expect(split.declared).toEqual({
      // The language comes from the template, not from the model
      example: {
        kind: 'code',
        source: 'def f():\n    return 1',
        language: 'python',
      },
      eq: { kind: 'math', tex: 'v = gt' },
      data: {
        kind: 'table',
        header: ['Year'],
        rows: [['2024'], ['2025']],
      },
    })
  })

  it('takes a table given as bare rows', () => {
    const split = splitGeneratedSlots(
      { data: [['2024', '812']] },
      'lab',
      AUTHORED,
    )
    expect(split.declared.data).toEqual({
      kind: 'table',
      rows: [['2024', '812']],
    })
  })
})

describe('content the layout did not ask for', () => {
  it('is discarded when the box does not exist', () => {
    // A slide is never left holding something its template has no box for
    const split = splitGeneratedSlots(
      { title: 'Kept', invented: 'Discarded' },
      'lab',
      CONVENTIONAL,
    )
    expect(split.title).toBe('Kept')
    expect(split.declared).toEqual({})
  })

  it('is discarded for a picture, which the model never writes', () => {
    // An image slot is filled by enrichment from the keywords; a URL the
    // model invented points at nothing
    const split = splitGeneratedSlots(
      { figure: 'http://invented.example/x.png' },
      'lab',
      AUTHORED,
    )
    expect(split.declared.figure).toBeUndefined()
  })

  it('cannot produce a formula where no box was declared for one', () => {
    // A history template that declares no maths box can never yield a formula
    const split = splitGeneratedSlots(
      { eq: 'v = gt', title: 'The Reformation' },
      'lab',
      CONVENTIONAL,
    )
    expect(split.declared).toEqual({})
    expect(split.title).toBe('The Reformation')
  })
})

describe('content of the wrong shape', () => {
  it('is coerced where that is unambiguous', () => {
    // One string where a list belongs is a point the model forgot to wrap
    const split = splitGeneratedSlots(
      { bullets: 'Only one point' },
      'lab',
      CONVENTIONAL,
    )
    expect(split.bullets).toEqual(['Only one point'])
  })

  it('is dropped where it is not', () => {
    // `5` as a bullet reading "5" is nonsense on a slide
    const split = splitGeneratedSlots({ bullets: 5 }, 'lab', CONVENTIONAL)
    expect(split.bullets).toBeUndefined()
  })

  it('refuses to invent a table out of prose', () => {
    // Guessing at structure would put rows and columns in front of a lecture
    // that nobody said
    const split = splitGeneratedSlots(
      { data: 'Year 2024, rainfall 812mm' },
      'lab',
      AUTHORED,
    )
    expect(split.declared.data).toBeUndefined()
  })

  it('drops an empty box rather than storing a blank', () => {
    const split = splitGeneratedSlots({ title: '   ', eq: '' }, 'lab', AUTHORED)
    expect(split.title).toBeUndefined()
    expect(split.declared).toEqual({})
  })
})

describe('a layout with no descriptor', () => {
  it('still takes the lecturer’s words into the conventional boxes', () => {
    // A deck whose template failed to resolve should not lose the lecture
    const split = splitGeneratedSlots(
      { title: 'Kept', body: 'Also kept', invented: 'x' },
      'unknown-layout',
      CONVENTIONAL,
    )
    expect(split).toMatchObject({ title: 'Kept', body: 'Also kept' })
    expect(split.declared).toEqual({})
  })
})

describe('whether anything survived', () => {
  it('is false when every box failed validation', () => {
    // The caller turns this into "no decision": a new slide with nothing on
    // it is not a slide
    expect(
      hasContent(splitGeneratedSlots({ bullets: 5 }, 'lab', CONVENTIONAL)),
    ).toBe(false)
  })

  it('is true when an authored box alone survived', () => {
    expect(
      hasContent(splitGeneratedSlots({ eq: 'v = gt' }, 'lab', AUTHORED)),
    ).toBe(true)
  })
})

describe('the layout a slide ends up on', () => {
  it('keeps only the boxes that layout declares', () => {
    // The slide may not land on the layout the content was written for:
    // image reconciliation moves it (GEN-7), and a slide being drawn on
    // keeps the layout it has (WB-1/WB-3)
    const kept = onlyDeclaredBy(
      {
        eq: { kind: 'math', tex: 'v = gt' },
        note: { kind: 'text', value: 'kept' },
      },
      'lab',
      layout([
        { name: 'note', kind: 'text', label: 'Note' },
        { name: 'title', kind: 'text', label: 'Title' },
      ]),
    )
    expect(kept).toEqual({ note: { kind: 'text', value: 'kept' } })
  })

  it('keeps nothing when the layout is one we have no descriptor for', () => {
    expect(
      onlyDeclaredBy(
        { eq: { kind: 'math', tex: 'v = gt' } },
        'unknown',
        AUTHORED,
      ),
    ).toEqual({})
  })

  it('has nothing to filter when the model wrote no authored boxes', () => {
    expect(onlyDeclaredBy(undefined, 'lab', AUTHORED)).toEqual({})
  })
})

describe('a code box is given code, or nothing (GEN-11)', () => {
  const codeLayout = [
    {
      type: 'content',
      label: 'Content',
      purpose: 'x',
      slots: [
        { name: 'title', kind: 'text' as const, label: 'Title' },
        { name: 'body', kind: 'code' as const, label: 'Slide body' },
      ],
    },
  ]
  const codeFor = (value: string) =>
    splitGeneratedSlots({ body: value }, 'content', codeLayout as never)
      .declared.body

  it('refuses the sentence the model sometimes writes instead', () => {
    // Seen in the wild, in a box whose kind was code: nothing downstream could
    // tell it from a listing, so it rendered monospaced, looking exactly like
    // the code it was describing
    expect(
      codeFor(
        'A while loop continues as long as n is greater than 10, containing an if-else statement for conditional logic.',
      ),
    ).toBeUndefined()
  })

  it('keeps a one-line program, which is still a program', () => {
    expect(codeFor('print(x)')).toMatchObject({ kind: 'code' })
    expect(codeFor('return n + 1')).toMatchObject({ kind: 'code' })
    expect(codeFor('pass')).toMatchObject({ kind: 'code' })
  })

  it('keeps anything with real line breaks', () => {
    expect(codeFor('def f():\n    return 1')).toMatchObject({ kind: 'code' })
  })

  it('leaves the box empty rather than filling it with something wrong', () => {
    // A half-filled slide is better than a slide that lies about what it holds
    const split = splitGeneratedSlots(
      { title: 'Loops', body: 'This snippet shows how a loop works.' },
      'content',
      codeLayout as never,
    )
    expect(split.declared.body).toBeUndefined()
    expect(split.title).toBe('Loops')
  })
})

describe('a maths box is given an expression, or nothing (GEN-11)', () => {
  const mathLayout = [
    {
      type: 'content',
      label: 'Content',
      purpose: 'x',
      slots: [{ name: 'eq', kind: 'math' as const, label: 'Equation' }],
    },
  ]
  const mathFor = (value: string) =>
    splitGeneratedSlots({ eq: value }, 'content', mathLayout as never).declared
      .eq

  it('refuses a sentence about the formula', () => {
    // Typesetting prose produces a line of upright words pretending to be
    // mathematics
    expect(
      mathFor('The quadratic formula gives the roots of a quadratic equation'),
    ).toBeUndefined()
  })

  it('keeps real LaTeX', () => {
    expect(mathFor('E = mc^2')).toMatchObject({ kind: 'math' })
    expect(mathFor('\\frac{a}{b}')).toMatchObject({ kind: 'math' })
    expect(mathFor('x')).toMatchObject({ kind: 'math' })
  })
})

describe('reading a slide’s authored boxes back out (GEN-11)', () => {
  const CODE = { kind: 'code', source: 'while n > 10:\n    n -= 1' } as const
  const MATH = { kind: 'math', tex: 'E = mc^2' } as const

  it('returns the boxes the author named, with what they hold', () => {
    // The whole point: an update REPLACES one of these, so the model has to
    // see the current listing to edit it rather than overwrite it
    expect(declaredContentOf({ example: CODE }, 'lab', AUTHORED)).toEqual({
      example: CODE,
    })
  })

  it('leaves out a box the conventional four already carry', () => {
    // `content.title` / `content.body` are sent in their own right; sending
    // them twice would spend prompt on nothing
    expect(
      declaredContentOf(
        {
          title: { kind: 'text', value: 'Loops' },
          body: { kind: 'text', value: 'A loop repeats.' },
          bullets: { kind: 'bullets', items: ['one'] },
          caption: { kind: 'text', value: 'Fig. 1' },
        },
        'lab',
        CONVENTIONAL,
      ),
    ).toEqual({})
  })

  it('keeps a conventionally-named box that holds something else', () => {
    // An author who turned "body" into a code box has a listing the prose
    // field cannot express — and it is exactly the box a lecturer edits aloud
    const codeBody = layout([
      { name: 'title', kind: 'text', label: 'Title' },
      { name: 'body', kind: 'code', label: 'Body' },
    ])
    expect(declaredContentOf({ body: CODE }, 'lab', codeBody)).toEqual({
      body: CODE,
    })
  })

  it('leaves pictures out', () => {
    // The model never writes one; a stored ref and its credit are noise
    const withImage = layout([
      { name: 'diagram', kind: 'image', label: 'Diagram' },
      { name: 'eq', kind: 'math', label: 'Equation' },
    ])
    expect(
      declaredContentOf(
        { diagram: { kind: 'image', ref: 'asset1' }, eq: MATH },
        'lab',
        withImage,
      ),
    ).toEqual({ eq: MATH })
  })

  it('drops a box the layout no longer declares', () => {
    // A slide keeps content its old layout held (remapSlots); showing the
    // model a box that is not on screen invites an edit that goes nowhere
    expect(declaredContentOf({ leftover: CODE }, 'lab', AUTHORED)).toEqual({})
  })

  it('is empty for a slide with no slot map at all', () => {
    expect(declaredContentOf(undefined, 'lab', AUTHORED)).toEqual({})
  })
})
