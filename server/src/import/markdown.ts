/**
 * What a text box held, written as Markdown (TMPL-8/EXP-5).
 *
 * A box on a real slide is rarely one thing. It is a sentence of context,
 * then the points that follow from it, then a closing line — with a word in
 * bold here and a link there. The importer had one kind per box: any bulleted
 * paragraph made the whole box a list, so the prose around it came back as
 * bullets nobody wrote, and the emphasis was dropped on the way because a
 * bullet is a plain string.
 *
 * Markdown is what the app already reads. `SlideMarkdown` renders paragraphs,
 * lists, bold, italic, code and links in any multi-line text slot, so a box
 * written this way comes back looking like the slide it came from — without a
 * new content model, a new renderer, or a second way for a slot to hold text.
 *
 * ## What is deliberately not carried
 *
 * Colour, size and typeface belong to the design, not to the sentence: they
 * are read off the box and live on its layout (`elementPositions`). Writing
 * them inline would freeze one slide's styling into its words and put it
 * beyond the reach of restyling the template.
 */
import type { SourceRun } from './source-presentation'

/** Characters Markdown would otherwise read as syntax. Escaped so a slide
 * that says `*` means `*` — a price list should not turn italic. */
const escapeMarkdown = (text: string): string =>
  text.replace(/([\\`*_[\]])/g, '\\$1')

/** One run, with the emphasis it was given. Nested innermost-first so bold
 * italic reads as `***word***` and not as two broken spans. */
const inline = (
  run: SourceRun,
  emphasis: { bold: boolean; italic: boolean },
): string => {
  const text = escapeMarkdown(run.text)
  if (!text.trim()) return text
  /*
   * Space around the words stays outside the markers.
   *
   * Google splits a run at the styling change, so a bolded lead-in arrives as
   * "Faculty " — space and all. Marked up whole that is `**Faculty **`, and
   * Markdown ignores emphasis whose closing marker is preceded by a space:
   * the asterisks rendered as asterisks, on the one slide the author had
   * bothered to emphasise.
   */
  const [, before, core, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  let out = core
  if (run.italic && emphasis.italic) out = `*${out}*`
  if (run.bold && emphasis.bold) out = `**${out}**`
  // The link goes outside the emphasis, so the whole styled phrase is what
  // you click rather than the asterisks landing inside the link text.
  if (run.link) out = `[${out}](${run.link})`
  return `${before}${out}${after}`
}

/**
 * Emphasis a box applies to every one of its words is not emphasis.
 *
 * A heading is often bold from end to end, because that is how the design
 * sets headings — and marking it `**bold**` would say the author stressed the
 * whole sentence, then render bold on top of a box that is already bold. What
 * every run shares belongs to the box (`elementPositions` carries it); what
 * only some runs have is the author stressing a phrase.
 */
const partial = (runs: SourceRun[], of: 'bold' | 'italic'): boolean => {
  const said = runs.filter(run => run.text.trim())
  return said.some(run => run[of]) && !said.every(run => run[of])
}

/** A line of the box: its words, and what kind of line it was. */
interface Line {
  text: string
  bulleted: boolean
  /** How deep the point sits, 0 for a top-level one. */
  level: number
  /** Numbered rather than bulleted. */
  ordered: boolean
}

/**
 * The lines a box held, each with the kind of paragraph it was.
 *
 * Runs carry the newlines the reader established (`read-slides`), so a line
 * may span several runs and a run may span several lines. The kind comes from
 * the run the line starts in, which is the paragraph it belongs to.
 */
const linesOf = (runs: SourceRun[]): Line[] => {
  const emphasis = {
    bold: partial(runs, 'bold'),
    italic: partial(runs, 'italic'),
  }
  const lines: Line[] = []
  let current: Line | undefined
  for (const run of runs) {
    const pieces = run.text.split('\n')
    pieces.forEach((piece, i) => {
      if (i > 0 || !current) {
        current = {
          text: '',
          bulleted: Boolean(run.bulleted),
          level: run.bulletLevel ?? 0,
          ordered: Boolean(run.ordered),
        }
        lines.push(current)
      } else if (!current.text) {
        // A run ending in a newline leaves an empty line behind it, and the
        // next run's first piece lands there. Its kind is that run's, not
        // the finished paragraph's — without this the first point of a list
        // was read as the prose above it.
        current.bulleted = Boolean(run.bulleted)
        current.level = run.bulletLevel ?? 0
        current.ordered = Boolean(run.ordered)
      }
      current.text += inline({ ...run, text: piece }, emphasis)
    })
  }
  return lines.filter(line => line.text.trim())
}

/**
 * The box as Markdown: prose as prose, bulleted paragraphs as a list.
 *
 * A blank line between a paragraph and the list that follows it, because
 * Markdown needs one to see them as separate blocks — without it the
 * paragraph swallows the first point.
 */
export const markdownOf = (runs: SourceRun[]): string => {
  const lines = linesOf(runs)
  if (!lines.length) return ''
  const out: string[] = []
  let previous: Line | undefined
  for (const line of lines) {
    if (previous && previous.bulleted !== line.bulleted) out.push('')
    if (line.bulleted) {
      // Two spaces a level, which is what Markdown reads as a sub-point.
      // Google keeps these as a nesting depth on the paragraph rather than as
      // a list inside a list, so the depth is all there is to go on.
      const indent = '  '.repeat(line.level)
      // `1.` for every numbered point: Markdown renumbers them in order, and
      // writing the real numbers would fight the renderer over any point
      // added later.
      out.push(`${indent}${line.ordered ? '1.' : '-'} ${line.text}`)
    } else {
      out.push(line.text)
    }
    // Prose paragraphs are their own blocks; points are one list together.
    if (previous && !previous.bulleted && !line.bulleted) {
      out.splice(out.length - 1, 0, '')
    }
    previous = line
  }
  return out.join('\n').trim()
}

/** Whether a box holds more than one kind of paragraph, and so is prose and
 * points together rather than a plain list. */
export const isMixed = (runs: SourceRun[]): boolean => {
  const lines = linesOf(runs)
  return lines.some(line => line.bulleted) && lines.some(line => !line.bulleted)
}

/** Whether any run points somewhere. A plain list of links is still a list,
 * but it has to be written as Markdown to keep them. */
export const hasLinks = (runs: SourceRun[]): boolean =>
  runs.some(run => Boolean(run.link))
