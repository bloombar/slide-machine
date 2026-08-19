/**
 * Unit tests for writing a text box as Markdown (TMPL-8/EXP-5).
 *
 * A box on a real slide is rarely one thing: a sentence of context, the
 * points that follow, a closing line, with a word in bold and a link. The
 * importer had one kind per box, so the prose came back as bullets nobody
 * wrote and the emphasis was dropped on the way.
 */
import { describe, it, expect } from 'vitest'
import { markdownOf, isMixed, hasLinks, isNested } from './markdown'
import type { SourceRun } from './source-presentation'

const run = (text: string, over: Partial<SourceRun> = {}): SourceRun => ({
  text,
  ...over,
})

describe('a box written as Markdown', () => {
  it('keeps prose as prose and points as a list', () => {
    const md = markdownOf([
      run('This is what I do:\n'),
      run('Faculty\n', { bulleted: true }),
      run('Student\n', { bulleted: true }),
      run('My job is about helping.'),
    ])
    expect(md).toBe(
      'This is what I do:\n\n- Faculty\n- Student\n\nMy job is about helping.',
    )
  })

  it('carries the emphasis a word was given', () => {
    const md = markdownOf([
      run('Faculty', { bold: true, bulleted: true }),
      run(' in the Division of Libraries', { bulleted: true }),
    ])
    expect(md).toBe('- **Faculty** in the Division of Libraries')
  })

  it('keeps the space outside the markers, or the emphasis is ignored', () => {
    // Google splits a run at the styling change, so a bolded lead-in arrives
    // as "Faculty " — space and all. Marked up whole, Markdown reads
    // `**Faculty **` as literal asterisks.
    expect(
      markdownOf([
        run('Faculty ', { bold: true, bulleted: true }),
        run('in the Division of Libraries', { bulleted: true }),
      ]),
    ).toBe('- **Faculty** in the Division of Libraries')
  })

  it('nests bold italic so it reads as one phrase', () => {
    expect(
      markdownOf([run('plain '), run('both', { bold: true, italic: true })]),
    ).toBe('plain ***both***')
  })

  it('keeps a link, with the styled phrase inside it', () => {
    const md = markdownOf([
      run('see '),
      run('the slides', { bold: true, link: 'https://x.test/a' }),
    ])
    expect(md).toBe('see [**the slides**](https://x.test/a)')
  })

  it('keeps a link even where nothing is emphasised', () => {
    expect(markdownOf([run('the slides', { link: 'https://x.test/a' })])).toBe(
      '[the slides](https://x.test/a)',
    )
  })

  it('does not mark up a heading that is bold end to end', () => {
    // That is how the design sets headings, not the author stressing the
    // whole sentence — and it would render bold on top of a bold box.
    expect(
      markdownOf([
        run('Finding ', { bold: true }),
        run('Data', { bold: true }),
      ]),
    ).toBe('Finding Data')
  })

  it('escapes what Markdown would otherwise read as syntax', () => {
    // A price list should not turn italic.
    expect(markdownOf([run('4 * 5 = 20')])).toBe('4 \\* 5 = 20')
  })

  it('separates two paragraphs, or they run into one', () => {
    expect(markdownOf([run('One.\n'), run('Two.')])).toBe('One.\n\nTwo.')
  })

  it('keeps consecutive points in a single list', () => {
    expect(
      markdownOf([
        run('A\n', { bulleted: true }),
        run('B', { bulleted: true }),
      ]),
    ).toBe('- A\n- B')
  })

  it('gives nothing back for a box holding nothing', () => {
    expect(markdownOf([run('   ')])).toBe('')
  })
})

describe('points that are nested or numbered', () => {
  it('indents a sub-point, which is how it was drawn', () => {
    // Google keeps a sub-point as a nesting depth on the paragraph rather
    // than as a list inside a list, so the depth is all there is to go on.
    expect(
      markdownOf([
        run('Steps\n', { bulleted: true }),
        run('First', { bulleted: true, bulletLevel: 1 }),
      ]),
    ).toBe('- Steps\n  - First')
  })

  it('numbers a numbered list, rather than dashing it', () => {
    expect(
      markdownOf([
        run('Form the question\n', { bulleted: true, ordered: true }),
        run('Scour the repositories', { bulleted: true, ordered: true }),
      ]),
    ).toBe('1. Form the question\n1. Scour the repositories')
  })

  it('keeps a numbered list and its lettered sub-points apart', () => {
    expect(
      markdownOf([
        run('Form the question\n', { bulleted: true, ordered: true }),
        run('Who', { bulleted: true, ordered: true, bulletLevel: 1 }),
      ]),
    ).toBe('1. Form the question\n  1. Who')
  })

  it('leaves a plain point unindented', () => {
    expect(markdownOf([run('A point', { bulleted: true })])).toBe('- A point')
  })
})

describe('deciding a box needs Markdown', () => {
  it('sees a box that is prose and points together', () => {
    expect(isMixed([run('Intro:\n'), run('A point', { bulleted: true })])).toBe(
      true,
    )
  })

  it('leaves a plain list alone', () => {
    // A list is still a list: it stays a bullets slot, which is editable as
    // one line per point.
    expect(
      isMixed([run('A\n', { bulleted: true }), run('B', { bulleted: true })]),
    ).toBe(false)
  })

  it('leaves plain prose alone', () => {
    expect(isMixed([run('Just a sentence.')])).toBe(false)
  })

  it('notices a list whose points are links', () => {
    expect(
      hasLinks([run('a', { bulleted: true, link: 'https://x.test' })]),
    ).toBe(true)
  })
})

/**
 * A list with a point under a point (TMPL-8).
 *
 * A box of bullets is stored as a list of strings, and a string has no depth,
 * so a sub-point came back level with its parent. The nesting was read
 * correctly all along — it was having nowhere to put it that lost it. Which is
 * why the same deck showed sub-points on some slides and not others: a box
 * that also held a link was already written as Markdown, and kept its depth,
 * while the box next to it was written as strings and did not.
 */
describe('a box whose points sit under one another', () => {
  const point = (text: string, level = 0) => ({
    text: `${text}\n`,
    bulleted: true,
    ...(level ? { bulletLevel: level } : {}),
  })

  it('is one to write as Markdown, which has somewhere to put the depth', () => {
    expect(isNested([point('Sources'), point('Government', 1)])).toBe(true)
  })

  it('is not, when every point is level with the others', () => {
    // The common case, and it must keep taking the plain path: a flat list is
    // a list of strings, which is what a bullets slot holds.
    expect(isNested([point('One'), point('Two')])).toBe(false)
  })

  it('is not, for prose that happens to be indented', () => {
    expect(isNested([{ text: 'Just a sentence\n' }])).toBe(false)
  })
})
