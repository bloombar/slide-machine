/**
 * Parses a remark.js lecture source file into a structured deck.
 *
 * The knowledge.kitchen course notes are written for remark.js: YAML
 * frontmatter, slides separated by `---` on its own line, incremental
 * reveals separated by `--`, and per-slide property lines (`name:`,
 * `class:`, `template:`) at the top of a slide.
 *
 * Everything here is pure — text in, plain objects out — so the mapping
 * to app slides can be tested without a database or a network.
 */

/** Property lines remark understands at the head of a slide. */
const SLIDE_PROPS = new Set([
  'name',
  'class',
  'template',
  'layout',
  'count',
  'background-image',
])

/**
 * Splits text into lines while tracking fenced code blocks, so separators
 * that appear *inside* a fence are never treated as markup. Course sources
 * really do contain `--` comment lines inside SQL fences and `---` inside
 * YAML samples; without this they would split a slide in half.
 */
const scanFences = lines => {
  const inFence = new Array(lines.length).fill(false)
  let fence = null
  lines.forEach((line, i) => {
    const match = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      inFence[i] = true
      if (
        match &&
        match[1][0] === fence[0] &&
        match[1].length >= fence.length
      ) {
        fence = null
      }
      return
    }
    if (match) {
      fence = match[1]
      inFence[i] = true
    }
  })
  return inFence
}

/**
 * Strips a leading YAML frontmatter block, returning its scalar keys and
 * the remaining body. Only the flat `key: value` form the course sources
 * use is understood; quotes around a value are removed.
 */
export const parseFrontmatter = text => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return { attrs: {}, body: lines.join('\n') }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end === -1) return { attrs: {}, body: lines.join('\n') }

  const attrs = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (match) attrs[match[1]] = unquote(match[2].trim())
  }
  return { attrs, body: lines.slice(end + 1).join('\n') }
}

const unquote = value =>
  /^(["'])(.*)\1$/.test(value) ? value.slice(1, -1) : value

/**
 * Splits a deck body into raw slide texts on `---` lines, ignoring any
 * that fall inside a fenced code block.
 */
export const splitSlides = body => {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const inFence = scanFences(lines)
  const slides = []
  let current = []
  lines.forEach((line, i) => {
    if (!inFence[i] && /^-{3,}\s*$/.test(line)) {
      slides.push(current.join('\n'))
      current = []
    } else {
      current.push(line)
    }
  })
  slides.push(current.join('\n'))
  return slides.map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * Peels the property lines off the top of a slide.
 *
 * remark reads `name: foo` style lines only at the very start of a slide,
 * before any content; once real content begins, a colon line is prose. The
 * same rule is applied here so a sentence like "Note: this matters" is
 * never mistaken for a property.
 */
export const parseSlideProps = raw => {
  const lines = raw.split('\n')
  const props = {}
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      // A blank line between properties is allowed; a blank line after
      // content is not our business (we have already stopped by then).
      if (Object.keys(props).length === 0 && i > 0) break
      continue
    }
    const match = /^([a-z][a-z-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (!match || !SLIDE_PROPS.has(match[1])) break
    props[match[1]] = match[2].trim()
  }
  return { props, content: lines.slice(i).join('\n').trim() }
}

/**
 * Removes incremental-reveal separators (`--`), outside fences only.
 *
 * A reveal is the same slide shown in stages, so the stages are joined
 * back into one slide's worth of content — the app has no stepped reveal
 * and the lecturer wants the whole point on the slide.
 */
export const stripReveals = content => {
  const lines = content.split('\n')
  const inFence = scanFences(lines)
  return lines
    .filter((line, i) => inFence[i] || !/^-{2}\s*$/.test(line))
    .join('\n')
    .trim()
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/

/** True for a table delimiter row such as `| --- | :--: |`. */
const isTableDivider = line =>
  /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes('-')

const splitRow = line =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())

/**
 * Turns a slide's markdown into an ordered list of typed blocks:
 * heading, paragraph, list, code, image, quote, table.
 *
 * A deliberately small parser for the small dialect these sources use —
 * it avoids adding a markdown dependency to the repo root, and every
 * construct it recognises is covered by tests.
 */
export const parseBlocks = md => {
  const lines = md.split('\n')
  const inFence = scanFences(lines)
  const blocks = []
  let i = 0

  const flushParagraph = buffer => {
    const text = buffer.join('\n').trim()
    if (!text) return
    const single = IMAGE_ONLY.exec(text)
    if (single) {
      blocks.push({ type: 'image', alt: single[1], url: single[2] })
    } else {
      blocks.push({ type: 'paragraph', text })
    }
  }

  let paragraph = []
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code — captured whole, never reinterpreted.
    if (inFence[i] && /^\s*(```+|~~~+)/.test(line)) {
      const fence = /^\s*(```+|~~~+)(.*)$/.exec(line)
      const language = fence[2].trim().split(/\s+/)[0] || undefined
      const source = []
      i++
      while (i < lines.length && !/^\s*(```+|~~~+)\s*$/.test(lines[i])) {
        source.push(lines[i])
        i++
      }
      i++ // closing fence
      flushParagraph(paragraph)
      paragraph = []
      blocks.push({
        type: 'code',
        language: normalizeLanguage(language),
        source: source.join('\n').replace(/\s+$/, ''),
      })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph(paragraph)
      paragraph = []
      blocks.push({
        type: 'heading',
        depth: heading[1].length,
        text: heading[2].trim(),
      })
      i++
      continue
    }

    // Table: a header row followed by a divider row.
    if (
      line.includes('|') &&
      lines[i + 1] !== undefined &&
      isTableDivider(lines[i + 1])
    ) {
      flushParagraph(paragraph)
      paragraph = []
      const header = splitRow(line)
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (/^\s*>/.test(line)) {
      flushParagraph(paragraph)
      paragraph = []
      const quote = []
      while (i < lines.length && (/^\s*>/.test(lines[i]) || !lines[i].trim())) {
        if (!lines[i].trim() && !/^\s*>/.test(lines[i + 1] ?? '')) break
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', text: quote.join('\n').trim() })
      continue
    }

    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      flushParagraph(paragraph)
      paragraph = []
      const ordered = /\d/.test(item[2])
      const items = []
      while (i < lines.length) {
        const next = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (next) {
          items.push({
            depth: Math.floor(next[1].length / 2),
            text: next[3].trim(),
          })
          i++
          continue
        }
        // A wrapped continuation line belongs to the item above it.
        if (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`
          i++
          continue
        }
        break
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (!line.trim()) {
      flushParagraph(paragraph)
      paragraph = []
      i++
      continue
    }

    paragraph.push(line)
    i++
  }
  flushParagraph(paragraph)
  return blocks
}

/**
 * Maps a fence's language tag to one the slide renderer highlights.
 * Unknown tags are kept as written; the renderer falls back to plain
 * monospace, which is better than dropping the author's label.
 */
const LANGUAGE_ALIASES = {
  sqlite: 'sql',
  jsx: 'javascript',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  branch: 'bash',
}

const normalizeLanguage = language =>
  language ? (LANGUAGE_ALIASES[language.toLowerCase()] ?? language) : undefined

// ---------------------------------------------------------------------------
// Whole-deck parsing
// ---------------------------------------------------------------------------

/**
 * Parses one lecture source file into `{ title, description, slides }`.
 *
 * Each slide carries its remark properties, its blocks, and the section
 * it belongs to. `template: foo` in remark means "continue from the slide
 * named foo", so the named slide's heading is carried down as the
 * section — that is what makes a continuation slide readable on its own.
 */
export const parseDeck = text => {
  const { attrs, body } = parseFrontmatter(text)
  const raw = splitSlides(body)

  const parsed = raw.map(slide => {
    const { props, content } = parseSlideProps(slide)
    return { props, blocks: parseBlocks(stripReveals(content)) }
  })

  // Headings of named slides, so `template:` references can inherit them.
  const sectionByName = new Map()
  for (const slide of parsed) {
    if (!slide.props.name) continue
    const h1 = slide.blocks.find(b => b.type === 'heading' && b.depth === 1)
    if (h1) sectionByName.set(slide.props.name, h1.text)
  }

  // A slide with no heading and no `template:` continues whatever section it
  // follows — that is how the source reads on the page, and without carrying
  // it forward such a slide would arrive in the app with no title at all.
  let running
  const slides = parsed.map(slide => {
    const inherited = slide.props.template
      ? sectionByName.get(slide.props.template)
      : undefined
    const own = slide.blocks.find(b => b.type === 'heading' && b.depth === 1)
    const section = own?.text ?? inherited ?? running
    running = section
    return { ...slide, section }
  })

  return {
    title: attrs.title ?? '',
    description: attrs.description ?? '',
    slides,
  }
}
