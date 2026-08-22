/**
 * Unit tests for the remark.js lecture parser.
 */
import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  splitSlides,
  parseSlideProps,
  stripReveals,
  parseBlocks,
  parseDeck,
} from './parse-remark.mjs'

describe('parseFrontmatter', () => {
  it('reads scalar keys and returns the remaining body', () => {
    const { attrs, body } = parseFrontmatter(
      '---\ntitle: Scrum\ndescription: "A talk."\n---\n\n# Hello\n',
    )
    expect(attrs).toEqual({ title: 'Scrum', description: 'A talk.' })
    expect(body.trim()).toBe('# Hello')
  })

  it('leaves a file with no frontmatter untouched', () => {
    const { attrs, body } = parseFrontmatter('# Hello\n')
    expect(attrs).toEqual({})
    expect(body).toBe('# Hello\n')
  })

  it('does not treat an unterminated block as frontmatter', () => {
    const { attrs, body } = parseFrontmatter('---\ntitle: Nope\n')
    expect(attrs).toEqual({})
    expect(body).toContain('title: Nope')
  })
})

describe('splitSlides', () => {
  it('splits on a horizontal rule and drops empty slides', () => {
    expect(splitSlides('# One\n\n---\n\n# Two\n\n---\n\n')).toEqual([
      '# One',
      '# Two',
    ])
  })

  /**
   * The course sources contain YAML and SQL samples whose own lines look
   * like slide separators. Splitting inside a fence would cut a listing in
   * half and scatter it over two slides.
   */
  it('ignores a separator inside a fenced code block', () => {
    const slides = splitSlides(
      '# One\n\n```yaml\nkey: value\n---\nnext: doc\n```\n\n---\n\n# Two',
    )
    expect(slides).toHaveLength(2)
    expect(slides[0]).toContain('next: doc')
  })
})

describe('parseSlideProps', () => {
  it('reads the property lines at the head of a slide', () => {
    const { props, content } = parseSlideProps(
      'name: overview\nclass: center, middle\n\n# Overview\n\nText.',
    )
    expect(props).toEqual({ name: 'overview', class: 'center, middle' })
    expect(content).toBe('# Overview\n\nText.')
  })

  it('leaves prose that merely contains a colon alone', () => {
    const { props, content } = parseSlideProps('Note: this is prose.')
    expect(props).toEqual({})
    expect(content).toBe('Note: this is prose.')
  })

  it('stops reading properties once content has begun', () => {
    const { props } = parseSlideProps('# Title\n\nname: not-a-prop')
    expect(props).toEqual({})
  })
})

describe('stripReveals', () => {
  it('drops the separator, leaving both stages on one slide', () => {
    expect(stripReveals('A\n\n--\n\nB')).toBe('A\n\n\nB')
    expect(stripReveals('A\n--\nB')).toBe('A\nB')
  })

  it('keeps SQL comment lines inside a fence', () => {
    const out = stripReveals('```sql\n-- a comment\nSELECT 1;\n```')
    expect(out).toContain('-- a comment')
  })
})

describe('parseBlocks', () => {
  it('reads headings at their depth', () => {
    expect(parseBlocks('# One\n\n## Two')).toEqual([
      { type: 'heading', depth: 1, text: 'One' },
      { type: 'heading', depth: 2, text: 'Two' },
    ])
  })

  it('reads a fenced listing whole, normalising its language', () => {
    const [block] = parseBlocks('```js\nconst a = 1\n\nconst b = 2\n```')
    expect(block).toEqual({
      type: 'code',
      language: 'javascript',
      source: 'const a = 1\n\nconst b = 2',
    })
  })

  it('keeps an unknown language tag as the author wrote it', () => {
    expect(parseBlocks('```mongodb\ndb.find()\n```')[0].language).toBe(
      'mongodb',
    )
  })

  it('reads ordered and unordered lists, recording nesting depth', () => {
    const [block] = parseBlocks('- one\n  - nested\n- two')
    expect(block.ordered).toBe(false)
    expect(block.items).toEqual([
      { depth: 0, text: 'one' },
      { depth: 1, text: 'nested' },
      { depth: 0, text: 'two' },
    ])
    expect(parseBlocks('1. a\n2. b')[0].ordered).toBe(true)
  })

  it('joins a wrapped continuation line onto the item above it', () => {
    const [block] = parseBlocks('- a point that\n  runs on')
    expect(block.items).toEqual([{ depth: 0, text: 'a point that runs on' }])
  })

  it('reads an image on its own line as an image, not a paragraph', () => {
    expect(parseBlocks('![Alt text](../assets/a.png)')).toEqual([
      { type: 'image', alt: 'Alt text', url: '../assets/a.png' },
    ])
  })

  it('reads a block quote', () => {
    expect(parseBlocks('> Line one\n> Line two')).toEqual([
      { type: 'quote', text: 'Line one\nLine two' },
    ])
  })

  it('reads a table with its header', () => {
    const [block] = parseBlocks(
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
    )
    expect(block).toEqual({
      type: 'table',
      header: ['A', 'B'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    })
  })

  it('keeps separate paragraphs separate', () => {
    expect(parseBlocks('One.\n\nTwo.')).toEqual([
      { type: 'paragraph', text: 'One.' },
      { type: 'paragraph', text: 'Two.' },
    ])
  })
})

describe('parseDeck', () => {
  const source = [
    '---',
    'title: Feature Branches',
    'description: "Isolated work."',
    '---',
    '',
    'class: center, middle',
    '',
    '# Feature Branches',
    '',
    'A subtitle.',
    '',
    '---',
    '',
    'name: overview',
    '',
    '# Overview',
    '',
    '--',
    '',
    '## Concept',
    '',
    'Some prose.',
    '',
    '---',
    '',
    'template: overview',
    '',
    '## Repositories',
    '',
    'More prose.',
    '',
    '---',
    '',
    '## A bare continuation',
    '',
    'Trailing prose.',
  ].join('\n')

  it('reads the deck title and description from frontmatter', () => {
    const deck = parseDeck(source)
    expect(deck.title).toBe('Feature Branches')
    expect(deck.description).toBe('Isolated work.')
  })

  it('carries a named slide’s heading down to slides that continue it', () => {
    const deck = parseDeck(source)
    expect(deck.slides[2].props.template).toBe('overview')
    expect(deck.slides[2].section).toBe('Overview')
  })

  /**
   * A slide with neither a heading nor a `template:` reference continues
   * whatever came before it — without this it would reach the app untitled.
   */
  it('carries the running section into a slide that declares nothing', () => {
    expect(parseDeck(source).slides[3].section).toBe('Overview')
  })

  it('merges an incremental reveal into the slide it belongs to', () => {
    const overview = parseDeck(source).slides[1]
    expect(overview.blocks.map(b => b.type)).toEqual([
      'heading',
      'heading',
      'paragraph',
    ])
  })
})
