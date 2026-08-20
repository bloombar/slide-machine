/**
 * Unit tests for rendering a slot's Markdown for an exporter (EXP-1/TMPL-8).
 *
 * An imported box is stored as Markdown, because a real slide's box is rarely
 * one thing. The viewer renders it; the exporters wrote the source out
 * verbatim, so a PDF carried `**Office hours** — see the [handbook](…)` with its asterisks showing
 * and every numbered point printed "1." — the source says `1.` on every line
 * and it is the renderer that counts them.
 */
import { describe, it, expect } from 'vitest'
import { markdownLines, looksLikeMarkdown } from './markdown-runs'

/** A line as "marker + words", for reading an assertion at a glance. */
const shown = (source: string): string[] =>
  markdownLines(source).map(
    line =>
      `${'  '.repeat(line.indent ?? 0)}${line.marker ? `${line.marker} ` : ''}${line.runs
        .map(run => run.text)
        .join('')}`,
  )

describe('counting a list', () => {
  it('numbers the points, rather than repeating what the source says', () => {
    // Every point is written "1." because Markdown renumbers and the real
    // numbers would fight any point added later. Nothing renumbers a PDF.
    expect(shown('1. One\n1. Two\n1. Three')).toEqual([
      '1. One',
      '2. Two',
      '3. Three',
    ])
  })

  it('letters the level below, and roman-numerals the one below that', () => {
    // The convention every document editor uses, and what the viewer draws —
    // so a slide counts the same on screen and in the file.
    expect(shown('1. One\n   1. Two\n      1. Three')).toEqual([
      '1. One',
      '  a. Two',
      '    i. Three',
    ])
  })

  it('starts a sub-list again under each parent', () => {
    expect(shown('1. One\n   1. a\n   1. b\n1. Two\n   1. a')).toEqual([
      '1. One',
      '  a. a',
      '  b. b',
      '2. Two',
      '  a. a',
    ])
  })

  it('starts a second list at one, rather than carrying on', () => {
    expect(shown('1. One\n1. Two\n\nSome prose\n\n1. Fresh')).toEqual([
      '1. One',
      '2. Two',
      '',
      'Some prose',
      '',
      '1. Fresh',
    ])
  })

  it('draws a bullet for a point that does not count', () => {
    // A dot, then a dash. Not the hollow circle the screen draws: a PDF's
    // standard fonts cannot encode one, and a character they cannot encode
    // fails the whole export rather than that one glyph.
    expect(shown('- One\n  - Two')).toEqual(['• One', '  – Two'])
  })

  it('reads a deeper indent as deeper, whatever its width', () => {
    // Two spaces under a dash, three under a number: the column is what says
    // how deep a point is, and it differs by the marker above it.
    expect(shown('- One\n    - Two')).toEqual(['• One', '  – Two'])
  })
})

describe('the words of a line', () => {
  it('strips the emphasis markers and sets the type instead', () => {
    const [line] = markdownLines('**Faculty** of *many* parts')
    expect(line!.runs).toEqual([
      { text: 'Faculty', bold: true },
      { text: ' of ' },
      { text: 'many', italic: true },
      { text: ' parts' },
    ])
  })

  it('reads bold italic as both, not as a broken span', () => {
    expect(markdownLines('***both***')[0]!.runs).toEqual([
      { text: 'both', bold: true, italic: true },
    ])
  })

  it('keeps where a link points, and shows only what it says', () => {
    const [line] = markdownLines(
      'See [the handbook](https://example.org/handbook) today',
    )
    expect(line!.runs).toEqual([
      { text: 'See ' },
      { text: 'the handbook', link: 'https://example.org/handbook' },
      { text: ' today' },
    ])
  })

  it('keeps the emphasis inside a link as well as the address', () => {
    expect(
      markdownLines('[*the handbook*](https://example.org/handbook)')[0]!.runs,
    ).toEqual([
      {
        text: 'the handbook',
        italic: true,
        link: 'https://example.org/handbook',
      },
    ])
  })

  it('gives an escaped marker back as the character it is', () => {
    // A slide that says `*` means `*` — the importer escapes them, and an
    // export that showed the backslash would be showing its own workings.
    expect(markdownLines('a \\* b')[0]!.runs).toEqual([{ text: 'a * b' }])
  })

  it('leaves a lone marker alone: a price list is not italic', () => {
    expect(markdownLines('5 * 3 = 15')[0]!.runs).toEqual([
      { text: '5 * 3 = 15' },
    ])
  })
})

describe('whether a box is worth reading as Markdown', () => {
  it('says yes to what the importer writes', () => {
    for (const text of [
      '- a point',
      '1. a point',
      '**bold**',
      'see [here](https://x)',
      'a `token`',
    ]) {
      expect([text, looksLikeMarkdown(text)]).toEqual([text, true])
    }
  })

  it('says no to ordinary prose, which renders the same either way', () => {
    for (const text of [
      'Photosynthesis happens in the chloroplasts.',
      'Rainfall 2024: 812mm',
      '5 * 3 = 15',
    ]) {
      expect([text, looksLikeMarkdown(text)]).toEqual([text, false])
    }
  })
})
