/**
 * Markdown in a slot, rendered for an exporter (EXP-1/TMPL-8).
 *
 * A box imported from a real slide is stored as Markdown, because a box is
 * rarely one thing: prose, then points, a bold lead-in, a link
 * (`import/markdown.ts`). The viewer renders it — `SlideMarkdown` — and the
 * exporters did not. They wrote the source out verbatim, so a PDF of an
 * imported lecture read
 *
 *     **Office hours** — see the [handbook](https://example.org/handbook)
 *
 * with the asterisks and brackets on the page, and every numbered point
 * printed "1." — because the source says `1.` on every line and it is the
 * renderer that counts them.
 *
 * ## Markers are drawn, not delegated
 *
 * The numbers and bullets are worked out here and written into the text,
 * rather than handed to each format's own list engine. PDF has none at all,
 * and PowerPoint's numbers its own way — so delegating would mean a slide that
 * counted differently in each place, which is the thing this whole export
 * model exists to prevent.
 *
 * ## Deliberately a small grammar
 *
 * What `import/markdown.ts` writes and no more: paragraphs, bullets, numbered
 * points, nesting, bold, italic, code, links. Anything else is left as the
 * text it is, which is what a reader would rather see than a marker.
 */

/** One piece of a line: its words, and how they are set. */
export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  mono?: boolean
  /** Where this piece points, if anywhere. */
  link?: string
}

/** One line of the box, with the marker it is drawn behind. */
export interface MarkdownLine {
  runs: InlineRun[]
  /** How deep a point sits; 0 for a top-level one, absent for prose. */
  indent?: number
  /** The marker drawn in front — "1. ", "a. ", "• " — already counted. */
  marker?: string
}

/** Escaped punctuation is the character itself, not a marker. */
const unescape = (text: string): string => text.replace(/\\([\\`*_[\]])/g, '$1')

/**
 * A line split into the pieces it is made of.
 *
 * One pass, longest marker first, so `***both***` is not read as bold with a
 * stray asterisk. A marker with no partner is left as the character it is: a
 * slide that says "5 * 3" means it.
 */
const inlineRuns = (text: string): InlineRun[] => {
  const runs: InlineRun[] = []
  const pattern =
    /\[([^\]]*)\]\(([^)]+)\)|(\*\*\*)([\s\S]+?)\3|(\*\*)([\s\S]+?)\5|(\*|_)([\s\S]+?)\7|`([^`]+)`/g
  let at = 0
  let match: RegExpExecArray | null
  const plain = (upTo: number) => {
    if (upTo > at) runs.push({ text: unescape(text.slice(at, upTo)) })
  }
  while ((match = pattern.exec(text))) {
    plain(match.index)
    if (match[1] !== undefined) {
      // A link: what it says, and where it goes. The label may be emphasised
      // in its own right, so it is split again rather than taken flat.
      for (const piece of inlineRuns(match[1]))
        runs.push({ ...piece, link: match[2] })
    } else if (match[3]) {
      runs.push({ text: unescape(match[4]!), bold: true, italic: true })
    } else if (match[5]) {
      runs.push({ text: unescape(match[6]!), bold: true })
    } else if (match[7]) {
      runs.push({ text: unescape(match[8]!), italic: true })
    } else {
      runs.push({ text: match[9]!, mono: true })
    }
    at = pattern.lastIndex
  }
  plain(text.length)
  return runs.filter(run => run.text)
}

/** The letter for a number, counting a, b, … z, aa, ab. */
const letter = (n: number): string => {
  let out = ''
  let left = n
  while (left > 0) {
    const digit = (left - 1) % 26
    out = String.fromCharCode(97 + digit) + out
    left = Math.floor((left - 1) / 26)
  }
  return out
}

/** The roman numeral for a number, lowercase. */
const roman = (n: number): string => {
  const parts: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let left = n
  let out = ''
  for (const [value, numeral] of parts) {
    while (left >= value) {
      out += numeral
      left -= value
    }
  }
  return out
}

/**
 * The marker for a counted point at this depth.
 *
 * Numbers, then letters, then roman numerals — the convention every document
 * editor uses, and the one the viewer draws (`SlideMarkdown`), so a slide
 * counts the same on screen and in the file.
 */
const counter = (depth: number, n: number): string =>
  depth === 0 ? `${n}.` : depth === 1 ? `${letter(n)}.` : `${roman(n)}.`

/**
 * The symbol for an uncounted point at this depth.
 *
 * A filled dot, then a dash, then a smaller dash — the shapes a reader reads
 * as "a point, and a point under it". Not the hollow circle and small square
 * the screen draws: a PDF's standard fonts are WinAnsi, which has neither, and
 * one character it cannot encode fails the whole export rather than that one
 * glyph. What matters is the nesting being legible, and these say it.
 */
const symbol = (depth: number): string =>
  depth === 0 ? '•' : depth === 1 ? '–' : '-'

/** How far a line is indented, in spaces, and what is left after the marker. */
const LIST = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/

/**
 * Markdown as lines an exporter can draw.
 *
 * Counting is per depth and resets when a list ends, so a second list on the
 * same slide starts at one rather than carrying on from the first.
 */
export const markdownLines = (source: string): MarkdownLine[] => {
  const lines: MarkdownLine[] = []
  /** How many points have been drawn at each depth of the list in progress. */
  let counts: number[] = []
  /** The indent columns seen, so a depth can be told from a column. */
  let columns: number[] = []
  for (const raw of source.split('\n')) {
    const match = LIST.exec(raw)
    if (!match) {
      // Prose ends whatever list was running: the next one starts at one.
      counts = []
      columns = []
      const text = raw.trim()
      if (text) lines.push({ runs: inlineRuns(text) })
      else if (lines.length) lines.push({ runs: [] })
      continue
    }
    const [, spaces, dash, digits, rest] = match
    const column = spaces!.length
    // The depth this column means: an indent wider than any seen is a level
    // deeper, one that matches a column already seen is that level again.
    let depth = columns.findIndex(c => c === column)
    if (depth === -1) {
      depth = columns.filter(c => c < column).length
      columns = [...columns.slice(0, depth), column]
      counts = counts.slice(0, depth)
    } else {
      columns = columns.slice(0, depth + 1)
      counts = counts.slice(0, depth + 1)
    }
    const counted = !dash && digits !== undefined
    counts[depth] = (counts[depth] ?? 0) + 1
    lines.push({
      runs: inlineRuns(rest!),
      indent: depth,
      marker: counted ? counter(depth, counts[depth]!) : symbol(depth),
    })
  }
  // A trailing blank line is spacing nobody asked for.
  while (lines.length && !lines[lines.length - 1]!.runs.length) lines.pop()
  return lines
}

/** Whether a slot's text is worth reading as Markdown rather than as plain
 * words. Cheap, and wrong only in the harmless direction: prose with no
 * markers renders the same either way. */
export const looksLikeMarkdown = (text: string): boolean =>
  /(^|\n)\s*(?:[-*+]|\d+[.)])\s+/.test(text) ||
  /\[[^\]]*\]\([^)]+\)/.test(text) ||
  /\*\*[\s\S]+?\*\*/.test(text) ||
  /(^|\s)[*_][^*_\s][\s\S]*?[*_](\s|$)/.test(text) ||
  /`[^`]+`/.test(text)
