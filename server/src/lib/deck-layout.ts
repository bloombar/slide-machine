/**
 * Shared slide-layout model for the deck exports (PDF, Google Slides). Given a
 * slide, it returns positioned boxes in normalized 0..1 slide coordinates that
 * mirror how the app's viewer arranges each layout type (client
 * components/slide/layouts): title/section/quote centered, content/list as
 * left-aligned text with NO image, image-heavy as a dominant image + caption,
 * and two-column as text beside an image. Both renderers draw from this, so the
 * PDF and the Slides output match each other AND the live viewer.
 *
 * Font sizes are a fraction of the slide WIDTH (the app uses `cqi` = %-of-width
 * container units), so each renderer multiplies by its own page width and the
 * relative sizes come out the same.
 */
import type { Layout, SlotBox, SlotValue } from '@slide-machine/shared'
import type { ExportSlide } from './deck-yaml'
import { resolveTreeBoxes } from './tree-boxes'
import { codeColor, highlightCode } from './code-highlight'
import {
  markdownLines,
  looksLikeMarkdown,
  type MarkdownLine,
} from './markdown-runs'

export type ColorRole = 'ink' | 'accent' | 'muted'

/** One paragraph within a text box. */
export interface LayoutRun {
  text: string
  /** Font size as a fraction of slide width. */
  sizeFrac: number
  bold?: boolean
  italic?: boolean
  color?: ColorRole
  /** A literal colour, overriding the role — what a syntax token is drawn in
   * (EXP-7). The roles are the slide's own three, and a listing needs more. */
  hex?: string
  bullet?: boolean
  /** Set in a monospaced face, with its spacing kept exactly: a listing or
   * preformatted text (EXP-7). */
  mono?: boolean
  /**
   * Which of the app's font stacks the box asks for (`client/.../fonts.ts`).
   *
   * Carried so an export is set in the same kind of typeface the screen is: a
   * deck imported from a design in Georgia used to come back from the exporter
   * in Helvetica, because the exporters knew only "monospaced or not".
   */
  family?: string
  /** Where this run points, if anywhere (EXP-5). A link is content: an
   * imported slide whose only address was in a link exported unreachable. */
  link?: string
  /** How deep a point sits, 0 for a top-level one. Drawn as an offset, so a
   * sub-point looks like one in the file as well as on the screen. */
  indent?: number
  /** Extra gap after this paragraph, as a fraction of slide width. */
  spaceAfterFrac?: number
  /** Continues the previous run on the same line instead of starting a new
   * one. Syntax colouring splits a line into several runs, and they have to
   * come back together as the line they were. */
  sameLine?: boolean
}

export interface TextBox {
  kind: 'text'
  x: number
  y: number
  w: number
  h: number
  align: 'left' | 'center'
  valign: 'top' | 'middle'
  runs: LayoutRun[]
  /** The slot this box draws, where one named it. Carried so an export can
   * say what a shape IS rather than only where it sits (EXP-8). Absent on the
   * hand-tuned arrangements, whose boxes are not slots. */
  slot?: string
  /**
   * A credit this system printed, rather than words the author wrote.
   *
   * The licence has to be readable in the exported file (IMG-5), so it is
   * drawn on the page — but it is not content: re-imported as content it
   * came back as a caption nobody made, while the picture's own provenance
   * dialog stayed empty. Marked here so the exporters can say so in the file
   * and the importer can leave it behind.
   */
  credit?: true
}
export interface ImageBox {
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  /** As TextBox.slot. */
  slot?: string
}
export interface RuleBox {
  kind: 'rule'
  x: number
  y: number
  w: number
  h: number
  color: ColorRole /** A literal colour, where the design names one rather than a role — an
   * imported band is whatever colour it was drawn, not one of three. */
  hex?: string
}
/**
 * A formula, to be typeset into the box rather than written into it (EXP-7).
 *
 * It carries its source rather than a picture because typesetting is
 * asynchronous and this model is not: the renderers ask for the picture when
 * they are ready to place it, and say so in the report when one cannot be
 * made.
 */
export interface MathBox {
  kind: 'math'
  x: number
  y: number
  w: number
  h: number
  tex: string
  slot?: string
}

/** Rows and columns, to be drawn as a table where the format has one and as a
 * ruled grid where it does not (EXP-7). */
export interface TableBox {
  kind: 'table'
  x: number
  y: number
  w: number
  h: number
  header?: string[]
  rows: string[][]
  /** How the table divides its own box, as fractions (EDIT-7). Carried through
   * so a table the author sized exports at those proportions rather than being
   * re-divided equally by each format. */
  colWidths?: number[]
  rowHeights?: number[]
  slot?: string
}

export type LayoutBox = TextBox | ImageBox | RuleBox | MathBox | TableBox

/** The image slot only appears in these layouts (matching the app: content/
 * list/title/etc. never render an image, even if the slide carries one).
 * Conventional layouts only — an arranged layout says for itself which of its
 * slots hold pictures. */
export const LAYOUT_HAS_IMAGE = new Set(['image-heavy', 'two-column'])

const titleRun = (
  slide: ExportSlide,
  sizeFrac: number,
  color: ColorRole,
  spaceAfterFrac = 0.03,
): LayoutRun[] =>
  slide.title
    ? [{ text: slide.title, sizeFrac, bold: true, color, spaceAfterFrac }]
    : []

const bodyRuns = (slide: ExportSlide, sizeFrac: number): LayoutRun[] => {
  const runs: LayoutRun[] = []
  if (slide.body)
    runs.push({ text: slide.body, sizeFrac, spaceAfterFrac: 0.02 })
  for (const bullet of slide.bullets ?? []) {
    runs.push({ text: bullet, sizeFrac, bullet: true, spaceAfterFrac: 0.012 })
  }
  return runs
}

/** The image's TASL attribution/license credit as one line, or '' — embedded
 * in exports so downstream copies stay license-compliant (IMG-5). */
const attributionCredit = (slide: ExportSlide): string => {
  const a = slide.attribution
  if (!a) return ''
  const parts: string[] = []
  if (a.title) parts.push(`"${a.title}"`)
  if (a.creator) parts.push(`by ${a.creator}`)
  if (a.sourceName) parts.push(`via ${a.sourceName}`)
  if (a.license) parts.push(`— ${a.license}`)
  return parts.join(' ').trim()
}

/** The type size of the small muted line under a picture. */
const FOOTER_SIZE = 0.011

/** Whether anything is printed beneath the picture — the author's caption,
 * the licence credit, or both — so an arrangement can leave room for it. */
const hasFooter = (slide: ExportSlide): boolean =>
  Boolean(slide.caption) || Boolean(attributionCredit(slide))

/** A muted line tucked directly beneath the image, matching the image's
 * column rather than the whole slide, so it reads as a figure credit rather
 * than a banner across the bottom (IMG-5). */
const footerLine = (
  text: string,
  img: { x: number; y: number; w: number; h: number },
  offset: number,
  credit?: true,
): LayoutBox => {
  const y = img.y + img.h + 0.015 + offset
  return {
    kind: 'text',
    x: img.x,
    y,
    w: img.w,
    h: Math.max(0, 1 - y - 0.01),
    align: 'center',
    valign: 'top',
    runs: [{ text, sizeFrac: FOOTER_SIZE, color: 'muted' }],
    ...(credit ? { credit } : {}),
  }
}

/**
 * The author's caption under the picture, where the arrangement has no box of
 * its own for one.
 *
 * The licence credit is NOT here. It goes under every picture, whatever
 * arrangement drew it (`withCredit`), and putting it here too gave a
 * template-arranged deck no credit at all while the hand-tuned arrangements
 * got two.
 */
const captionBox = (
  slide: ExportSlide,
  img: { x: number; y: number; w: number; h: number },
): LayoutBox[] => (slide.caption ? [footerLine(slide.caption, img, 0)] : [])

/** A box's colour, mapped onto the three roles an export can draw in. */
const roleOf = (color: string | undefined): ColorRole | undefined => {
  if (color === 'accent' || color === 'muted') return color
  return color ? 'ink' : undefined
}

/**
 * A box's colour where it names one outright, rather than a role.
 *
 * The three roles are a template's palette, and a design imported from
 * somewhere else does not have one — its boxes carry the colours they were
 * drawn in. Those went through `roleOf`, which answers "ink" to anything it
 * does not recognise, so every box of an imported deck exported in the theme's
 * body colour: a red heading printed grey, and a slide of three colours
 * printed in one.
 *
 * `hex` already exists on a run for exactly this reason — a syntax token's own
 * colour — and the exporters already prefer it over the role.
 */
const literalOf = (color: string | undefined): string | undefined =>
  color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined

/**
 * A listing's lines, each split into the coloured pieces it is made of.
 *
 * One run per piece, with every run after the first on a line marked as
 * continuing it — so a line that is `def`, a space, and `add` is drawn as one
 * line in three colours rather than three lines (EXP-7).
 */
const codeRuns = (
  source: string,
  language: string | undefined,
  sizeFrac: number,
  background: string,
): LayoutRun[] => {
  const runs: LayoutRun[] = []
  for (const [index, line] of source.split('\n').entries()) {
    const spans = highlightCode(line, language)
    if (!spans.length) {
      // A blank line is still a line, and a listing's blank lines are part of
      // how it reads.
      runs.push({ text: '', sizeFrac, mono: true, ...(index ? {} : {}) })
      continue
    }
    spans.forEach((span, i) => {
      const hex = codeColor(span.token, background)
      runs.push({
        text: span.text,
        sizeFrac,
        mono: true,
        ...(hex ? { hex } : {}),
        ...(i > 0 ? { sameLine: true } : {}),
      })
    })
  }
  return runs
}

/**
 * The box a slot needs when it is not text: a formula or a table.
 *
 * Kept apart from the runs because these are not paragraphs — a formula is
 * typeset into a picture and a table is drawn as a grid, and writing either
 * one out as characters is exactly what EXP-7 forbids.
 */
const specialBox = (
  value: SlotValue | undefined,
  geometry: { x: number; y: number; w: number; h: number },
  slot?: string,
): LayoutBox | null => {
  if (!value) return null
  if (value.kind === 'math')
    return value.tex.trim()
      ? { kind: 'math', ...geometry, tex: value.tex, ...(slot ? { slot } : {}) }
      : null
  if (value.kind === 'table')
    return value.rows.length || value.header?.length
      ? {
          kind: 'table',
          ...geometry,
          ...(value.header?.length ? { header: value.header } : {}),
          rows: value.rows,
          ...(value.colWidths?.length ? { colWidths: value.colWidths } : {}),
          ...(value.rowHeights?.length ? { rowHeights: value.rowHeights } : {}),
          ...(slot ? { slot } : {}),
        }
      : null
  return null
}

/**
 * One rendered Markdown line as runs: its marker, then its words.
 *
 * The marker is a run of its own so it is not bolded along with a bold
 * lead-in, and every run after the first continues the line rather than
 * starting one.
 */
const runsOfLine = (
  line: MarkdownLine,
  style: {
    sizeFrac: number
    bold?: boolean
    color?: ColorRole
    hex?: string
    family?: string
  },
  linkColor?: string,
): LayoutRun[] => {
  const indent = line.indent
  const base = { ...style, ...(indent !== undefined ? { indent } : {}) }
  const runs: LayoutRun[] = []
  if (line.marker)
    runs.push({ ...base, text: `${line.marker} `, bold: undefined })
  for (const piece of line.runs) {
    runs.push({
      ...base,
      text: piece.text,
      // The box's own weight still applies where the sentence asks for none.
      bold: piece.bold || style.bold,
      ...(piece.italic ? { italic: true } : {}),
      ...(piece.mono ? { mono: true } : {}),
      ...(piece.link
        ? {
            link: piece.link,
            // Drawn in the design's link colour, as the screen draws it.
            ...(linkColor ? { hex: linkColor } : {}),
          }
        : {}),
      ...(runs.length ? { sameLine: true } : {}),
    })
  }
  // A blank line is a paragraph break, and still has to occupy one.
  if (!runs.length) runs.push({ ...base, text: '' })
  return runs
}

/**
 * A layout's own decoration as boxes: the colour it is painted, the bands and
 * rules drawn on it (TMPL-8).
 *
 * Pictures are left out. A logo is stored as the template's own file and would
 * have to be fetched per layout, which the export does per slide; the fills
 * are what carry a design's colour, and drawing them is the difference between
 * an imported deck exporting as itself and exporting on blank white.
 */
const decorationBoxes = (layout: Layout): LayoutBox[] =>
  (layout.decoration ?? [])
    .filter(piece => piece.fill)
    .map(piece => ({
      kind: 'rule' as const,
      x: piece.x,
      y: piece.y,
      w: piece.w,
      h: piece.h,
      color: roleOf(piece.fill) ?? 'accent',
      ...(literalOf(piece.fill) ? { hex: literalOf(piece.fill)! } : {}),
    }))

/** The paragraphs one slot contributes, whatever kind it holds. */
const runsForSlot = (
  value: SlotValue | undefined,
  box: SlotBox,
  background = '#ffffff',
  /** What this design draws a link in, where it says (TMPL-8). The screen
   * draws links in it, and a file that did not would be a different slide. */
  linkColor?: string,
): LayoutRun[] => {
  // A box's fontSize is `cqi` — a percent of slide width — and the export
  // model measures type as a fraction of that same width, so this is /100
  // rather than a guess.
  const sizeFrac = (box.fontSize ?? 4) / 100
  const color = roleOf(box.color)
  const hex = literalOf(box.color)
  const bold = (box.fontWeight ?? 400) >= 600 ? true : undefined
  const family = box.fontFamily
  if (!value) return []
  switch (value.kind) {
    case 'text':
      if (!value.value) return []
      /*
       * A box stored as Markdown is RENDERED, not written out.
       *
       * An imported box holds Markdown, because a real slide's box is rarely
       * one thing (`import/markdown.ts`). The viewer renders it; the exporters
       * wrote the source, so a PDF carried "**Office hours**" with its
       * asterisks showing, and every numbered point printed "1." — the source
       * says `1.` on every line and it is the renderer that counts them.
       */
      if (looksLikeMarkdown(value.value))
        return markdownLines(value.value).flatMap(line =>
          runsOfLine(line, { sizeFrac, bold, color, hex, family }, linkColor),
        )
      return [{ text: value.value, sizeFrac, bold, color, hex, family }]
    case 'preformatted':
      // Its spacing is the content: monospaced, and split by line so nothing
      // reflows it (EXP-7).
      return value.value
        ? value.value
            .split('\n')
            .map(text => ({ text, sizeFrac, color, mono: true }))
        : []
    case 'bullets':
      return value.items.map(text => ({
        text,
        sizeFrac,
        bullet: true,
        color,
        hex,
        family,
        spaceAfterFrac: sizeFrac * 0.3,
      }))
    case 'code':
      return value.source
        ? codeRuns(value.source, value.language, sizeFrac, background)
        : []
    case 'math':
    case 'table':
      // Neither is text. They become boxes of their own, so that an export
      // draws a formula and a table rather than writing out their source
      // (EXP-7, `specialBox`).
      return []
    default:
      return []
  }
}

/**
 * What a slide will put in each box, one entry per paragraph.
 *
 * The tree is resolved against the slide's REAL content rather than a sample,
 * so a box is as tall as the words it actually holds — which is the whole
 * reason the export can match the screen.
 */
const linesOf =
  (slide: ExportSlide) =>
  (name: string): string[] => {
    const value = slide.slots?.[name]
    if (!value) return []
    switch (value.kind) {
      case 'bullets':
        return value.items
      case 'text':
      case 'preformatted':
        return value.value ? [value.value] : []
      case 'code':
        return value.source ? value.source.split('\n') : []
      case 'math':
        return value.tex ? [value.tex] : []
      case 'table':
        return value.rows.map(row => row.join('  '))
      default:
        return []
    }
  }

/**
 * The boxes a layout's TREE asks for — the same arrangement, resolved the same
 * way, that the browser draws on screen (TMPL-4).
 *
 * This is read before `elementPositions` because the tree is the design and
 * the geometry is derived from it. The derivation happens in the editor, by
 * measuring what the browser drew *for the preview's sample content*: a
 * centred box shrinks to fit what it held at that moment, so a title measured
 * around three words is stored as a box three words wide. Drawing a real
 * lecture's title in it puts the words somewhere the design never asked for,
 * and the slide the audience saw and the slide in the export stop matching.
 *
 * `elementPositions` remains the fallback, because a design imported from
 * Google Slides is absolute geometry with no tree to resolve (TMPL-8).
 */
const treeLayout = (
  slide: ExportSlide,
  layout: Layout,
  theme: Record<string, unknown> | undefined,
  background: string,
  link?: string,
): LayoutBox[] | null => {
  if (!layout.tree) return null
  const boxes: LayoutBox[] = []
  for (const box of resolveTreeBoxes(layout, theme ?? {}, linesOf(slide))) {
    const geometry = { x: box.x, y: box.y, w: box.w, h: box.h }
    if (!box.slot) {
      // Decoration — a rule or band drawn from its style alone, like the
      // accent bar a section break sits under.
      boxes.push({
        kind: 'rule',
        ...geometry,
        color: roleOf(box.style.background) ?? 'accent',
        // The colour it was actually drawn in, where the design names one.
        ...(literalOf(box.style.background)
          ? { hex: literalOf(box.style.background)! }
          : {}),
      })
      continue
    }
    if (box.kind === 'image') {
      boxes.push({ kind: 'image', ...geometry, slot: box.slot })
      continue
    }
    const value = slide.slots?.[box.slot]
    const special = specialBox(value, geometry, box.slot)
    if (special) {
      boxes.push(special)
      continue
    }
    const runs = runsForSlot(value, box.style as SlotBox, background, link)
    if (!runs.length) continue
    boxes.push({
      kind: 'text',
      ...geometry,
      align: box.style.align === 'center' ? 'center' : 'left',
      valign: box.style.vAlign === 'center' ? 'middle' : 'top',
      runs,
      slot: box.slot,
    })
  }
  // A layout whose slots the slide left empty has nothing to draw, and the
  // arrangements below still know what to do with a bare title.
  return boxes.length ? boxes : null
}

/**
 * The boxes an ARRANGED layout asks for (TMPL-4). The template placed every
 * slot itself, so the export draws exactly that instead of the hand-tuned
 * arrangement below — which is what makes a PDF match the screen.
 */
const arrangedLayout = (
  slide: ExportSlide,
  layout: Layout,
  background: string,
  link?: string,
): LayoutBox[] | null => {
  const positions = layout.elementPositions ?? {}
  if (!Object.keys(positions).length) return null
  const boxes: LayoutBox[] = []
  // Declaration order decides paint order, exactly as it does on screen.
  for (const spec of layout.slots) {
    const box = positions[spec.name]
    if (!box) continue
    const geometry = { x: box.x, y: box.y, w: box.w, h: box.h }
    if (spec.kind === 'image') {
      boxes.push({ kind: 'image', ...geometry, slot: spec.name })
      continue
    }
    const value = slide.slots?.[spec.name]
    const special = specialBox(value, geometry, spec.name)
    if (special) {
      boxes.push(special)
      continue
    }
    const runs = runsForSlot(value, box, background, link)
    if (!runs.length) continue
    boxes.push({
      kind: 'text',
      ...geometry,
      align: box.align === 'center' ? 'center' : 'left',
      valign: box.vAlign === 'center' ? 'middle' : 'top',
      runs,
      slot: spec.name,
    })
  }
  return boxes
}

/**
 * Computes the layout boxes for a slide.
 *
 * A template that arranged this layout is drawn from its own boxes; the
 * switch below is the hand-tuned arrangement the built-ins rely on, and stays
 * the fallback for any layout that carries no geometry.
 */
/**
 * The licence credit under whichever box shows the picture.
 *
 * Applied to every arrangement, because IMG-5 is not a property of one: a
 * deck laid out by its own template needs its credit exactly as much as one
 * falling back to a built-in shape, and putting the credit in only the
 * fallbacks left every template-arranged export with no attribution at all.
 *
 * Marked as a credit so the exporters can name it in the file and a re-import
 * can leave it behind — it is printed on the page, but it is not something
 * the author wrote (`TextBox.credit`).
 */
const withCredit = (slide: ExportSlide, boxes: LayoutBox[]): LayoutBox[] => {
  const credited = attributionCredit(slide)
  if (!credited) return boxes
  // Already added by an arrangement that draws its own footer.
  if (boxes.some(box => box.kind === 'text' && box.credit)) return boxes
  const img = boxes.find(box => box.kind === 'image')
  if (!img) return boxes
  // Under the caption where there is one, so the two do not overlap.
  const captioned = boxes.some(
    box => box.kind === 'text' && !box.credit && box.y > img.y + img.h,
  )
  return [
    ...boxes,
    footerLine(credited, img, captioned ? FOOTER_SIZE * 1.6 : 0, true),
  ]
}

export const computeLayout = (
  slide: ExportSlide,
  layout?: Layout,
  theme?: Record<string, unknown>,
): LayoutBox[] => withCredit(slide, arrangeBoxes(slide, layout, theme))

/** The boxes an arrangement draws, before the licence credit is added. */
const arrangeBoxes = (
  slide: ExportSlide,
  layout?: Layout,
  theme?: Record<string, unknown>,
): LayoutBox[] => {
  if (layout) {
    // The same order the renderer picks in: the tree is the design, the
    // measured geometry is derived from it, and the arrangements below are
    // what a layout with neither still gets.
    const background =
      typeof theme?.background === 'string' ? theme.background : '#ffffff'
    const link = typeof theme?.link === 'string' ? theme.link : undefined
    /*
     * The design's own bands and rules, drawn first so everything else sits
     * on top of them.
     *
     * An imported layout carries these (`import/build-template`): the colour
     * it is painted, the line under every title, the panel behind a column.
     * The exporters drew the boxes and none of the design, so an imported
     * deck exported onto a blank white page — the same slides, with the
     * design taken off.
     */
    const design = decorationBoxes(layout)
    const drawn = treeLayout(slide, layout, theme, background, link)
    if (drawn) return [...design, ...drawn]
    const arranged = arrangedLayout(slide, layout, background, link)
    if (arranged) return [...design, ...arranged]
  }
  switch (slide.layoutType) {
    case 'title':
      return [
        {
          kind: 'text',
          x: 0.08,
          y: 0,
          w: 0.84,
          h: 1,
          align: 'center',
          valign: 'middle',
          runs: [
            ...titleRun(slide, 0.072, 'ink', slide.caption ? 0.03 : 0),
            ...(slide.caption
              ? [
                  {
                    text: slide.caption,
                    sizeFrac: 0.03,
                    color: 'muted' as const,
                  },
                ]
              : []),
          ],
        },
      ]

    case 'section':
      return [
        { kind: 'rule', x: 0.46, y: 0.4, w: 0.08, h: 0.008, color: 'accent' },
        {
          kind: 'text',
          x: 0.1,
          y: 0.02,
          w: 0.8,
          h: 1,
          align: 'center',
          valign: 'middle',
          runs: titleRun(slide, 0.055, 'ink', 0),
        },
      ]

    case 'quote':
      return [
        {
          kind: 'text',
          x: 0.08,
          y: 0,
          w: 0.84,
          h: 1,
          align: 'center',
          valign: 'middle',
          runs: [
            ...(slide.body
              ? [
                  {
                    text: `“${slide.body}”`,
                    sizeFrac: 0.04,
                    italic: true,
                    spaceAfterFrac: slide.caption ? 0.03 : 0,
                  },
                ]
              : []),
            ...(slide.caption
              ? [
                  {
                    text: slide.caption,
                    sizeFrac: 0.028,
                    color: 'muted' as const,
                  },
                ]
              : []),
          ],
        },
      ]

    case 'image-heavy': {
      const img = {
        x: 0.04,
        y: 0.04,
        w: 0.92,
        h: hasFooter(slide) ? 0.82 : 0.9,
      }
      return [{ kind: 'image', ...img }, ...captionBox(slide, img)]
    }

    case 'two-column': {
      // Image size is fixed; the tiny credit line tucks in the space beneath.
      const img = { x: 0.52, y: 0.1, w: 0.42, h: 0.72 }
      return [
        {
          kind: 'text',
          x: 0.06,
          y: 0,
          w: 0.4,
          h: 1,
          align: 'left',
          valign: 'middle',
          runs: [...titleRun(slide, 0.04, 'accent'), ...bodyRuns(slide, 0.025)],
        },
        { kind: 'image', ...img },
        ...captionBox(slide, img),
      ]
    }

    case 'list':
    case 'content':
      return [
        {
          kind: 'text',
          x: 0.06,
          y: 0,
          w: 0.88,
          h: 1,
          align: 'left',
          valign: 'middle',
          runs: [
            ...titleRun(slide, 0.04, 'accent'),
            ...bodyRuns(slide, 0.0275),
          ],
        },
      ]

    default: {
      // Unknown layout: a safe general arrangement — title, then body/bullets,
      // with the image on the right if the slide has one.
      const hasImg = Boolean(slide.imageRef)
      const img = { x: 0.58, y: 0.13, w: 0.36, h: 0.74 }
      return [
        {
          kind: 'text',
          x: 0.06,
          y: 0.08,
          w: hasImg ? 0.5 : 0.88,
          h: 0.84,
          align: 'left',
          valign: 'top',
          runs: [
            ...titleRun(slide, 0.045, 'accent'),
            ...bodyRuns(slide, 0.028),
          ],
        },
        // The image and its credit only when the slide actually has one.
        ...(hasImg
          ? [{ kind: 'image' as const, ...img }, ...captionBox(slide, img)]
          : []),
      ]
    }
  }
}
