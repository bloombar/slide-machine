/**
 * Round-trip and safety tests for the SHARE-2 Markdown ↔ HTML converter.
 *
 * Round-trips are asserted on the rendered HTML, not the raw Markdown string:
 * remark-stringify normalizes syntax (`_em_` becomes `*em*`, `*` in prose gains
 * a backslash), so comparing source text would fail on differences the viewer
 * cannot show. Comparing the HTML both forms render to is the property that
 * actually matters — the slide looks the same.
 */
import { describe, expect, it } from 'vitest'
import {
  htmlToMarkdown,
  markdownToHtml,
  restoreLinkHrefs,
} from './markdown-html'

/** Markdown → HTML → Markdown, the path a translated field takes. */
const roundTrip = (md: string, inline = false): string =>
  htmlToMarkdown(markdownToHtml(md, { inline }))

/** Asserts a round-trip renders identically to the original. */
const expectStable = (md: string, inline = false): void => {
  expect(markdownToHtml(roundTrip(md, inline), { inline })).toBe(
    markdownToHtml(md, { inline }),
  )
}

describe('markdownToHtml', () => {
  it('renders the inline whitelist', () => {
    expect(
      markdownToHtml('**bold** and *em* and `code`', { inline: true }),
    ).toBe('<strong>bold</strong> and <em>em</em> and <code>code</code>')
  })

  it('renders links', () => {
    expect(
      markdownToHtml('see [the docs](https://example.com/a)', {
        inline: true,
      }),
    ).toBe('see <a href="https://example.com/a">the docs</a>')
  })

  it('unwraps the paragraph for inline fields but keeps it for block fields', () => {
    expect(markdownToHtml('a title', { inline: true })).toBe('a title')
    expect(markdownToHtml('a body')).toBe('<p>a body</p>')
  })

  it('keeps multiple paragraphs wrapped in block fields', () => {
    expect(markdownToHtml('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>')
  })

  it('treats a single newline as a line break, like the viewer', () => {
    expect(markdownToHtml('one\ntwo')).toContain('<br>')
  })

  it('returns empty for blank input', () => {
    expect(markdownToHtml('')).toBe('')
    expect(markdownToHtml('   \n  ')).toBe('')
    expect(htmlToMarkdown('')).toBe('')
  })

  it('drops raw HTML tags in the source, as the viewer does', () => {
    // The tags go; whatever sat between them stays as inert prose. This is
    // exactly what react-markdown renders, so a translated slide reads the
    // same as the original — and no markup survives to execute.
    const html = markdownToHtml('hi <script>alert(1)</script> there')
    expect(html).not.toContain('<script')
    expect(html).toBe('<p>hi alert(1) there</p>')
  })

  it("drops block structure that is the template layout's job", () => {
    expect(markdownToHtml('# Heading')).not.toContain('<h1')
  })
})

describe('htmlToMarkdown', () => {
  it('strips tags outside the whitelist down to their text', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('Title')
    expect(htmlToMarkdown('<span class="x">plain</span>')).toBe('plain')
  })

  it('removes scripts entirely', () => {
    expect(htmlToMarkdown('<p>ok</p><script>alert(1)</script>')).not.toContain(
      'alert',
    )
  })

  it('drops attributes other than href', () => {
    const md = htmlToMarkdown('<p class="evil" onclick="x()">text</p>')
    expect(md).toBe('text')
  })

  it('drops javascript: link targets', () => {
    const md = htmlToMarkdown('<a href="javascript:alert(1)">click</a>')
    expect(md).not.toContain('javascript:')
  })

  it('converts a <br> back to the newline it came from', () => {
    expect(htmlToMarkdown('one<br>two')).toBe('one\ntwo')
  })
})

describe('round-trip stability', () => {
  const inlineCases: Array<[string, string]> = [
    ['plain prose', 'Just some words.'],
    ['bold', 'a **bold** word'],
    ['emphasis', 'an *emphasized* word'],
    ['strikethrough', 'a ~~struck~~ word'],
    ['inline code', 'call `render()` now'],
    ['nested emphasis', '***both*** at once'],
    ['bold inside emphasis', '*outer **inner** outer*'],
    ['link', 'read [the guide](https://example.com/guide)'],
    ['link with a query string', '[q](https://example.com/s?a=1&b=2)'],
    [
      'link with parens in the url',
      '[wiki](https://en.wikipedia.org/wiki/A_(b))',
    ],
    ['mailto link', 'mail [us](mailto:a@example.com)'],
    ['link containing bold', '[**bold link**](https://example.com)'],
    ['literal asterisks in prose', 'multiply 2 * 3 * 4'],
    ['literal underscores', 'snake_case_name stays'],
    ['unicode', 'Français, Русский, 中文 — em dash'],
    ['line break', 'first line\nsecond line'],
  ]
  it.each(inlineCases)('is stable for %s', (_name, md) => {
    expectStable(md, true)
  })

  const blockCases: Array<[string, string]> = [
    ['a paragraph', 'One sentence. Another sentence.'],
    ['two paragraphs', 'First para.\n\nSecond para.'],
    ['an unordered list', '- one\n- two\n- three'],
    ['an ordered list', '1. first\n2. second'],
    ['a list with formatting', '- **bold** item\n- [link](https://a.example)'],
    ['a paragraph then a list', 'Intro:\n\n- one\n- two'],
  ]
  it.each(blockCases)('is stable for %s', (_name, md) => {
    expectStable(md)
  })

  it('is stable across a second round-trip', () => {
    const md = 'a **bold** [link](https://example.com/x?y=1) and `code`'
    const once = roundTrip(md, true)
    expect(roundTrip(once, true)).toBe(once)
  })
})

describe('restoreLinkHrefs', () => {
  it('puts the source hrefs back when a translation rewrites them', () => {
    const source = markdownToHtml('[docs](https://example.com/en)', {
      inline: true,
    })
    const translated = '<a href="https://example.com/fr">documentation</a>'
    const fixed = restoreLinkHrefs(source, translated)
    expect(fixed).toContain('href="https://example.com/en"')
    expect(fixed).toContain('documentation')
  })

  it('restores several links in document order', () => {
    const source = markdownToHtml(
      '[a](https://a.example) then [b](https://b.example)',
      {
        inline: true,
      },
    )
    const translated =
      '<a href="https://x.example">un</a> puis <a href="https://y.example">deux</a>'
    const fixed = restoreLinkHrefs(source, translated)
    expect(fixed).toBe(
      '<a href="https://a.example">un</a> puis <a href="https://b.example">deux</a>',
    )
  })

  it('leaves the translation alone when the link counts disagree', () => {
    const source = markdownToHtml('[a](https://a.example)', { inline: true })
    const translated =
      '<a href="https://x.example">un</a> <a href="https://y.example">deux</a>'
    expect(restoreLinkHrefs(source, translated)).toBe(translated)
  })

  it('is a no-op when the source has no links', () => {
    expect(restoreLinkHrefs('<p>plain</p>', '<p>simple</p>')).toBe(
      '<p>simple</p>',
    )
  })
})
