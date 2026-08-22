/**
 * Unit tests for the markdown-to-slide-model mapping.
 */
import { describe, it, expect } from 'vitest'
import { parseDeck } from './parse-remark.mjs'
import {
  deckToSlides,
  budgetsFromTemplate,
  DEFAULT_BUDGETS,
} from './to-slides.mjs'

/** Builds a deck from source text, as the importer does. */
const convert = (markdown, options = {}) =>
  deckToSlides(parseDeck(markdown), options)

/** A source file with frontmatter and a leading cover slide. */
const withCover = body =>
  `---\ntitle: T\n---\n\nclass: center, middle\n\n# Cover\n\nSubtitle.\n\n---\n\n${body}`

describe('the cover slide', () => {
  it('becomes a title layout carrying the subtitle as its caption', () => {
    const [first] = convert(withCover('# Next\n\nProse.'))
    expect(first.layoutType).toBe('title')
    expect(first.slots.title.value).toBe('Cover')
    expect(first.slots.caption.value).toBe('Subtitle.')
  })
})

describe('layout selection', () => {
  it('makes a heading with nothing under it a section divider', () => {
    const slides = convert(withCover('# Overview'))
    expect(slides[1]).toEqual({
      layoutType: 'section',
      slots: { title: { kind: 'text', value: 'Overview' } },
    })
  })

  it('puts prose alone on a content slide', () => {
    const [, slide] = convert(withCover('## Concept\n\nSome prose.'))
    expect(slide.layoutType).toBe('content')
    expect(slide.slots.body.value).toBe('Some prose.')
    expect(slide.slots.title.value).toBe('Concept')
  })

  it('puts points alone on a list slide', () => {
    const [, slide] = convert(withCover('## Points\n\n- one\n- two'))
    expect(slide.layoutType).toBe('list')
    expect(slide.slots.bullets).toEqual({
      kind: 'bullets',
      items: ['one', 'two'],
    })
  })

  it('puts prose and points together on a content-list slide', () => {
    const [, slide] = convert(withCover('## Both\n\nLead in.\n\n- one\n- two'))
    expect(slide.layoutType).toBe('content-list')
    expect(slide.slots.body.value).toBe('Lead in.')
    expect(slide.slots.bullets.items).toEqual(['one', 'two'])
  })

  it('puts a picture beside prose on a two-column slide', () => {
    const [, slide] = convert(
      withCover('## Diagram\n\nExplanation.\n\n![Alt](https://x/a.png)'),
    )
    expect(slide.layoutType).toBe('two-column')
    expect(slide.slots.image).toEqual({
      kind: 'image',
      ref: 'https://x/a.png',
      source: 'seeded',
    })
    expect(slide.slots.body.value).toBe('Explanation.')
  })

  it('gives a picture with no prose the image layout, alt text as caption', () => {
    const [, slide] = convert(
      withCover('## Shot\n\n![The thing](https://x/a.png)'),
    )
    expect(slide.layoutType).toBe('image-heavy')
    expect(slide.slots.caption.value).toBe('The thing')
  })

  it('gives a quotation the quote layout, splitting off its attribution', () => {
    const [, slide] = convert(
      withCover('## Manifesto\n\n> We value this.\n>\n> -Someone'),
    )
    expect(slide.layoutType).toBe('quote')
    expect(slide.slots.body.value).toBe('We value this.')
    expect(slide.slots.caption.value).toBe('Someone')
  })
})

describe('program listings', () => {
  /**
   * A listing has to reach a real code slot: the slide renderer draws only
   * inline markdown in a text box, so a fenced block pasted into prose would
   * arrive as a run-together paragraph rather than as code.
   */
  it('lands in a code slot with its language', () => {
    const [, slide] = convert(withCover('## Commit\n\n```bash\ngit add .\n```'))
    expect(slide.layoutType).toBe('code')
    expect(slide.slots.snippet).toEqual({
      kind: 'code',
      source: 'git add .',
      language: 'bash',
    })
  })

  it('is never merged with the prose around it', () => {
    const slides = convert(
      withCover(
        '## Steps\n\nFirst do this.\n\n```bash\ngit add .\n```\n\nThen that.',
      ),
    )
    expect(slides.slice(1).map(s => s.layoutType)).toEqual([
      'content',
      'code',
      'content',
    ])
  })

  it('gives each of several listings a slide of its own', () => {
    const slides = convert(
      withCover('## Two\n\n```bash\na\n```\n\n```bash\nb\n```'),
    )
    expect(slides.slice(1).map(s => s.slots.snippet.source)).toEqual(['a', 'b'])
  })
})

describe('overflow', () => {
  it('splits points across slides rather than dropping any', () => {
    const items = Array.from({ length: 14 }, (_, i) => `- point ${i + 1}`).join(
      '\n',
    )
    const slides = convert(withCover(`## Many\n\n${items}`)).slice(1)
    expect(slides.every(s => s.layoutType === 'list')).toBe(true)
    // maxBullets is 6 for the list layout: 14 points fill three slides.
    expect(slides).toHaveLength(3)
    const all = slides.flatMap(s => s.slots.bullets.items)
    expect(all).toHaveLength(14)
    expect(all[13]).toBe('point 14')
  })

  it('splits long prose between paragraphs, keeping every word', () => {
    const paragraph = `${'word '.repeat(60).trim()}.`
    const slides = convert(
      withCover(`## Long\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`),
    ).slice(1)
    expect(slides.length).toBeGreaterThan(1)
    const joined = slides.map(s => s.slots.body.value).join('\n\n')
    expect(joined.split('word')).toHaveLength(180 + 1)
  })

  it('marks a continuation slide, and only a continuation', () => {
    const items = Array.from({ length: 8 }, (_, i) => `- p${i}`).join('\n')
    const [, first, second] = convert(withCover(`## Short\n\n${items}`))
    expect(first.slots.title.value).toBe('Short')
    expect(second.slots.title.value).toBe('Short (cont.)')
  })

  /**
   * Several of these lectures already say "(continued again)" in the
   * author's own heading; appending another marker read badly and pushed
   * the title past the layout's budget.
   */
  it('leaves a title that already says it is continued alone', () => {
    const items = Array.from({ length: 8 }, (_, i) => `- p${i}`).join('\n')
    const slides = convert(withCover(`## Await (continued again)\n\n${items}`))
    expect(slides[2].slots.title.value).toBe('Await (continued again)')
  })

  it('drops the marker rather than overrun the title budget', () => {
    const long = 'A title of just about the maximum length allowed!!'
    const items = Array.from({ length: 8 }, (_, i) => `- p${i}`).join('\n')
    const slides = convert(withCover(`## ${long}\n\n${items}`))
    expect(long).toHaveLength(50)
    expect(slides[2].slots.title.value).toBe(long)
  })
})

describe('tables', () => {
  it('become bullets, since no built-in layout holds a grid', () => {
    const [, slide] = convert(
      withCover('## Grid\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'),
    )
    expect(slide.slots.bullets.items).toEqual(['**A — B**', '1 — 2'])
  })
})

describe('link and image resolution', () => {
  const resolve = url =>
    url.startsWith('http') ? url : `https://site${url.replace(/^\.\./, '')}`

  it('rewrites a relative image path to an absolute URL', () => {
    const [, slide] = convert(withCover('## Pic\n\n![A](../assets/a.png)'), {
      resolve,
    })
    expect(slide.slots.image.ref).toBe('https://site/assets/a.png')
  })

  it('rewrites a link inside prose', () => {
    const [, slide] = convert(withCover('## Text\n\nSee [docs](/a/b).'), {
      resolve,
    })
    expect(slide.slots.body.value).toBe('See [docs](https://site/a/b).')
  })
})

describe('template awareness', () => {
  const template = {
    layouts: [
      { type: 'content', constraints: { maxBodyChars: 400 } },
      { type: 'list', constraints: { maxBullets: 2 } },
      { type: 'title', constraints: {} },
    ],
  }

  it('reads each layout’s real budgets off the template', () => {
    expect(budgetsFromTemplate(template).list).toEqual({ maxBullets: 2 })
    expect(budgetsFromTemplate(undefined)).toEqual(DEFAULT_BUDGETS)
  })

  it('paginates to the template’s own limits', () => {
    const items = Array.from({ length: 4 }, (_, i) => `- p${i}`).join('\n')
    const slides = convert(withCover(`## Many\n\n${items}`), {
      template,
    }).slice(1)
    expect(slides).toHaveLength(2)
  })

  /**
   * A template need not declare every conventional layout, and
   * `slide.editContent` rejects a slot the chosen layout does not have — so
   * the mapping falls back to a layout the template actually offers.
   */
  it('falls back when the template lacks the layout the content wants', () => {
    const [, slide] = convert(withCover('## Points\n\n- one\n- two'), {
      template: { layouts: [{ type: 'content', constraints: {} }] },
    })
    expect(slide.layoutType).toBe('content')
    expect(slide.slots.body.value).toContain('- one')
  })

  /**
   * The fallback used to keep the prose and drop the points, which loses
   * content silently — the one thing this mapping must never do.
   */
  it('keeps both prose and points when falling back to a content slide', () => {
    const [, slide] = convert(
      withCover('## Both\n\nLead in.\n\n- one\n- two'),
      {
        template: { layouts: [{ type: 'content', constraints: {} }] },
      },
    )
    expect(slide.layoutType).toBe('content')
    expect(slide.slots.body.value).toContain('Lead in.')
    expect(slide.slots.body.value).toContain('- one')
    expect(slide.slots.body.value).toContain('- two')
  })
})
