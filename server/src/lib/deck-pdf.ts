/**
 * Renders a slide deck to a PDF slide deck (SPEC EXP-1): one 16:9 landscape
 * sheet per slide (no cover page). Each slide is arranged by its layout type —
 * via the shared layout model (deck-layout) that mirrors the app's viewer — so
 * title/section/quote center, content/list are left text, image-heavy is a big
 * image, and two-column is text beside an image. The Google Slides export
 * (deck-pptx) draws from the same model, so the two match. Freehand whiteboard
 * marks (WB-1) are drawn on top.
 *
 * Built with `pdf-lib` (pure JS). Images are fetched (shared with the Slides
 * export) with bounded concurrency + retry and WebP→PNG conversion; a missing
 * image is skipped.
 */
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  LineCapStyle,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import type { Layout } from '@slide-machine/shared'
import type { ExportNote } from '@slide-machine/shared'
import { tableTracks } from '@slide-machine/shared'
import { pdfFamily } from './export-fonts'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexToRgb01, HIGHLIGHTER_ALPHA } from './deck-drawings'
import { imageCredit } from './image-credit'
import { fetchSlideImages } from './deck-image'
import { typesetFormulas } from './deck-formulas'
import { fitScale } from './fit-scale'
import { DEFAULT_THEME, type ExportTheme } from './deck-theme'
import {
  computeLayout,
  type ColorRole,
  type LayoutRun,
  type TableBox,
  type TextBox,
} from './deck-layout'

const PX = 96
const PAGE_WIDTH = 10 * PX // 960
const PAGE_HEIGHT = 5.625 * PX // 540

/** A pdf-lib color from a #hex string. */
const hex = (s: string): Color => {
  const c = hexToRgb01(s)
  return rgb(c.r, c.g, c.b)
}

/** The layout color roles resolved to pdf-lib colors for a template theme. */
const themeColors = (theme: ExportTheme): Record<ColorRole, Color> => ({
  ink: hex(theme.text),
  accent: hex(theme.accent),
  muted: hex(theme.muted),
})

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  /** For listings and preformatted text, whose spacing is the content. */
  mono: PDFFont
  /** The same three again with serifs, for a design that asked for them
   * (TMPL-8). A deck laid out in Georgia used to be written in Helvetica. */
  serif: PDFFont
  serifBold: PDFFont
  serifItalic: PDFFont
}

const fontFor = (fonts: Fonts, run: LayoutRun): PDFFont => {
  // A listing is set in a monospaced face so its indentation survives; the
  // proportional faces would close up the leading spaces (EXP-7).
  if (run.mono || pdfFamily(run.family) === 'mono') return fonts.mono
  const serif = pdfFamily(run.family) === 'serif'
  if (run.bold) return serif ? fonts.serifBold : fonts.bold
  if (run.italic) return serif ? fonts.serifItalic : fonts.italic
  return serif ? fonts.serif : fonts.regular
}

/** A run's own colour where it has one — a syntax token — and the slide's
 * role otherwise. */
const colorFor = (run: LayoutRun): Color =>
  run.hex ? hex(run.hex) : colors[run.color ?? 'ink']

/** Breaks text into lines that fit `maxWidth` at the given font size. */
const wrapLines = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate
      } else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/**
 * The characters a standard PDF font can actually draw.
 *
 * pdf-lib's standard fonts are WinAnsi-encoded, and `drawText` THROWS on a
 * character outside it — so a single arrow, a box-drawing rule or a word of
 * Chinese anywhere in a deck failed the entire export, and the author was told
 * only "could not export the deck". A missing glyph is a small loss; a missing
 * file is the lecture.
 *
 * The common typographic ones are mapped to something that reads the same, and
 * anything left is dropped rather than replaced with a question mark, which
 * says less than the space it takes.
 */
const WINANSI =
  /[\x20-\x7E\xA0-\xFF\u2018\u2019\u201A\u201C\u201D\u201E\u2013\u2014\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122\u0160\u0161\u017D\u017E\u0152\u0153\u0192\u02C6\u02DC]/

/** What to draw instead, for characters a slide is likely to hold. */
const SUBSTITUTE: Record<string, string> = {
  '◦': '-',
  '▪': '-',
  '‣': '-',
  '·': '-',
  '→': '->',
  '←': '<-',
  '⇒': '=>',
  '↔': '<->',
  '×': 'x',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
  '\u00a0': ' ',
  '\u200b': '',
  '\ufeff': '',
}

/** A string the standard fonts can draw, whatever the slide holds. */
const drawable = (text: string): string =>
  [...text].map(ch => (WINANSI.test(ch) ? ch : (SUBSTITUTE[ch] ?? ''))).join('')

/** One piece of a drawn line: some characters set one way. */
interface Piece {
  text: string
  size: number
  font: PDFFont
  color: Color
  /** Where these characters point, if anywhere. */
  link?: string
}

/** A line as it will be drawn, and the gap that follows it. */
interface DrawnLine {
  pieces: Piece[]
  gapAfter: number
  /** How far in the line starts — a sub-point's offset. */
  indent?: number
}

/**
 * Makes a rectangle of the page follow a link when clicked.
 *
 * A PDF carries links as annotations on the page rather than as anything in
 * the text, so this is the only way to have one: the words are drawn, and a
 * clickable box is laid over where they landed. Without it an imported slide
 * whose only address was inside a link exported unreachable — reading an
 * address off a page is not the same as following it.
 *
 * Bordered with a zero width, because a PDF reader's default is to draw a box
 * around every link, and a slide is a design.
 */
const linkAnnotation = (
  page: PDFPage,
  url: string,
  at: { x: number; y: number; width: number; height: number },
): void => {
  const doc = page.doc
  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [at.x, at.y, at.x + at.width, at.y + at.height],
    Border: [0, 0, 0],
    A: doc.context.obj({
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(url),
    }),
  })
  const existing = page.node.Annots()
  if (existing) existing.push(doc.context.register(annotation))
  else
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([doc.context.register(annotation)]),
    )
}

/**
 * Lays a text box's runs into lines and draws them, honoring the box's
 * horizontal and vertical alignment — the app's flex/justify.
 *
 * Two things a run can ask for beyond its words. A run may **continue the
 * previous line** rather than start one, which is how a listing's coloured
 * pieces come back together as the line they were (EXP-7). And a run may be
 * **monospaced**, in which case it is not wrapped: a listing that reflows is a
 * different listing, and its author chose where the lines break.
 */
const drawTextBox = (page: PDFPage, box: TextBox): void => {
  const bw = box.w * PAGE_WIDTH
  const bxLeft = box.x * PAGE_WIDTH
  const boxTop = PAGE_HEIGHT - box.y * PAGE_HEIGHT
  const bh = box.h * PAGE_HEIGHT

  const laidOut = (scale: number): DrawnLine[] => {
    const lines: DrawnLine[] = []
    for (const run of box.runs) {
      const size = run.sizeFrac * PAGE_WIDTH * scale
      const font = fontFor(fonts, run)
      const color = colorFor(run)
      const text = drawable((run.bullet ? '•  ' : '') + run.text)
      const gapAfter = (run.spaceAfterFrac ?? 0) * PAGE_WIDTH * scale
      // A sub-point is drawn as one. Indented by the type size, so the offset
      // holds its proportion when a crowded box shrinks to fit.
      const indent = (run.indent ?? 0) * size * 1.5

      const last = lines[lines.length - 1]
      if (run.sameLine && last) {
        last.pieces.push({ text, size, font, color, link: run.link })
        last.gapAfter = gapAfter
        continue
      }
      // A listing keeps the lines its author wrote; prose wraps to its box.
      const segments = run.mono
        ? [text]
        : wrapLines(text, font, size, bw - indent)
      segments.forEach((segment, i) =>
        lines.push({
          pieces: [{ text: segment, size, font, color, link: run.link }],
          gapAfter: i === segments.length - 1 ? gapAfter : 0,
          indent,
        }),
      )
    }
    return lines
  }

  const heightOf = (line: DrawnLine) =>
    Math.max(...line.pieces.map(p => p.size), 0) * 1.32
  const widthOf = (line: DrawnLine) =>
    line.pieces.reduce(
      (w, p) => w + p.font.widthOfTextAtSize(p.text, p.size),
      0,
    )
  const tallyOf = (drawn: DrawnLine[]): number =>
    drawn.reduce((h, line) => h + heightOf(line) + line.gapAfter, 0)

  // Type gives way before content does, as it does on screen (`fit-scale`).
  const scale = fitScale(at => tallyOf(laidOut(at)), bh)
  const lines = laidOut(scale)
  const totalH = tallyOf(lines)

  let cursorTop = box.valign === 'middle' ? boxTop - (bh - totalH) / 2 : boxTop
  for (const line of lines) {
    const lineH = heightOf(line)
    const left = bxLeft + (line.indent ?? 0)
    let x = box.align === 'center' ? bxLeft + (bw - widthOf(line)) / 2 : left
    for (const piece of line.pieces) {
      const width = piece.font.widthOfTextAtSize(piece.text, piece.size)
      page.drawText(piece.text, {
        x,
        y: cursorTop - piece.size,
        size: piece.size,
        font: piece.font,
        color: piece.color,
      })
      // A link is content (EXP-5), and a PDF can carry one: an imported slide
      // whose only address was inside a link exported unreachable, and reading
      // it off the page is not the same as following it.
      if (piece.link)
        linkAnnotation(page, piece.link, {
          x,
          y: cursorTop - piece.size,
          width,
          height: piece.size * 1.2,
        })
      x += width
    }
    cursorTop -= lineH + line.gapAfter
  }
}

/**
 * A table as a ruled grid, since PDF has no table of its own (EXP-7).
 *
 * Every cell is ruled, not just the rows — the same grid the slide draws, so
 * the table an audience saw is the table in the file. Columns and rows are
 * drawn to the proportions the table carries (EDIT-7), which is how the slide
 * drew them; a table nobody sized divides its box equally, as it always did.
 */
const drawTableBox = (page: PDFPage, box: TableBox): void => {
  const rows = box.header?.length ? [box.header, ...box.rows] : box.rows
  if (!rows.length) return
  const columns = Math.max(...rows.map(r => r.length), 1)
  const bw = box.w * PAGE_WIDTH
  const bh = box.h * PAGE_HEIGHT
  const left = box.x * PAGE_WIDTH
  const top = PAGE_HEIGHT - box.y * PAGE_HEIGHT
  // Fractions of the box, read the same way the viewer reads them.
  const widths = tableTracks(box.colWidths, columns).map(f => f * bw)
  const heights = tableTracks(box.rowHeights, rows.length).map(f => f * bh)
  /** Where a track starts, from the sizes of the ones before it. */
  const offset = (sizes: number[], upTo: number) =>
    sizes.slice(0, upTo).reduce((sum, n) => sum + n, 0)
  // Type is sized to the shortest row, so no row's text is taller than the
  // cell it sits in.
  const size = Math.min(Math.min(...heights) * 0.45, PAGE_WIDTH * 0.018)
  const pad = size * 0.5

  rows.forEach((row, r) => {
    const cellH = heights[r]!
    const rowTop = top - offset(heights, r)
    for (let c = 0; c < columns; c++) {
      const cellW = widths[c]!
      const cellLeft = left + offset(widths, c)
      page.drawRectangle({
        x: cellLeft,
        y: rowTop - cellH,
        width: cellW,
        height: cellH,
        borderColor: colors.muted,
        borderWidth: 0.5,
      })
      const heading = Boolean(box.header?.length) && r === 0
      const font = heading ? fonts.bold : fonts.regular
      const text = row[c] ?? ''
      if (!text) continue
      page.drawText(clipToWidth(text, font, size, cellW - pad * 2), {
        x: cellLeft + pad,
        y: rowTop - size - pad,
        size,
        font,
        color: colors.ink,
      })
    }
  })
}

/** As much of a cell's text as fits its column. A table's cells are read at a
 * glance, so an overlong one is cut rather than allowed to run into its
 * neighbour. */
const clipToWidth = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string => {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return `${cut}…`
}

// Set per document (embedded fonts are document-scoped; colors are per deck).
let fonts: Fonts
let colors: Record<ColorRole, Color> = themeColors(DEFAULT_THEME)

/** Draws a slide's boxes (image, rule, text) then its whiteboard marks. */
const drawSlide = (
  page: PDFPage,
  slide: ExportSlide,
  image?: PDFImage,
  layout?: Layout,
  templateTheme?: Record<string, unknown>,
  formulas?: Map<string, PDFImage>,
): void => {
  for (const box of computeLayout(slide, layout, templateTheme)) {
    if (box.kind === 'text') {
      drawTextBox(page, box)
    } else if (box.kind === 'table') {
      drawTableBox(page, box)
    } else if (box.kind === 'math') {
      // Typeset, never written out — a maths lecture whose formulas export
      // as LaTeX is unusable (EXP-7).
      const drawn = formulas?.get(box.tex)
      if (!drawn) continue
      const bw = box.w * PAGE_WIDTH
      const bh = box.h * PAGE_HEIGHT
      const scale = Math.min(bw / drawn.width, bh / drawn.height)
      const w = drawn.width * scale
      const h = drawn.height * scale
      const boxTop = PAGE_HEIGHT - box.y * PAGE_HEIGHT
      page.drawImage(drawn, {
        x: box.x * PAGE_WIDTH + (bw - w) / 2,
        y: boxTop - (bh - h) / 2 - h,
        width: w,
        height: h,
      })
    } else if (box.kind === 'rule') {
      page.drawRectangle({
        x: box.x * PAGE_WIDTH,
        y: PAGE_HEIGHT - box.y * PAGE_HEIGHT - box.h * PAGE_HEIGHT,
        width: box.w * PAGE_WIDTH,
        height: box.h * PAGE_HEIGHT,
        // The colour the design names, where it names one (TMPL-8): an
        // imported band is whatever it was drawn, not one of three roles.
        color: box.hex ? hex(box.hex) : colors[box.color],
      })
    } else if (box.kind === 'image' && image) {
      const bw = box.w * PAGE_WIDTH
      const bh = box.h * PAGE_HEIGHT
      const scale = Math.min(bw / image.width, bh / image.height) // contain
      const w = image.width * scale
      const h = image.height * scale
      const boxTop = PAGE_HEIGHT - box.y * PAGE_HEIGHT
      const drawnX = box.x * PAGE_WIDTH + (bw - w) / 2
      const drawnY = boxTop - (bh - h) / 2 - h
      page.drawImage(image, { x: drawnX, y: drawnY, width: w, height: h })

      // The picture's provenance, under the picture it belongs to (IMG-5).
      // Tucked against the image rather than in a page footer, so a slide
      // with two pictures credits each where it sits — and so a reader can
      // tell which credit is whose.
      const credit = imageCredit(slide.attribution)
      if (credit) {
        const size = 6
        page.drawText(credit, {
          x: drawnX,
          // Just below the image, clamped so a picture at the very bottom of
          // the page does not print its credit off the edge.
          y: Math.max(4, drawnY - size - 2),
          size,
          font: fonts.regular,
          color: colors.muted,
          maxWidth: Math.max(w, 120),
        })
      }
    }
  }
  drawStrokes(page, slide)
}

/** Draws the slide's freehand whiteboard marks on top (points are 0..1 of the
 * slide; PDF's y-axis is bottom-up). */
const drawStrokes = (page: PDFPage, slide: ExportSlide): void => {
  for (const stroke of visibleStrokes(slide.drawings)) {
    const pts = stroke.points
    if (!pts.length) continue
    const c = hexToRgb01(stroke.color)
    const color = rgb(c.r, c.g, c.b)
    const opacity = stroke.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1
    const thickness = Math.max(0.75, stroke.thickness * PAGE_WIDTH)
    const px = (nx: number) => nx * PAGE_WIDTH
    const py = (ny: number) => PAGE_HEIGHT - ny * PAGE_HEIGHT
    if (pts.length === 1) {
      page.drawCircle({
        x: px(pts[0]!.x),
        y: py(pts[0]!.y),
        size: thickness / 2,
        color,
        opacity,
      })
      continue
    }
    for (let i = 1; i < pts.length; i++) {
      page.drawLine({
        start: { x: px(pts[i - 1]!.x), y: py(pts[i - 1]!.y) },
        end: { x: px(pts[i]!.x), y: py(pts[i]!.y) },
        thickness,
        color,
        opacity,
        lineCap: LineCapStyle.Round,
      })
    }
  }
}

/** Builds the deck's PDF: one 16:9 page per slide, in display order. */
export const deckToPdf = async (
  deck: ExportDeck,
  /** Collects what a format could not carry, for the export's report
   * (EXP-7). */
  notes?: ExportNote[],
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.setTitle(deck.title)
  fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  }
  // Apply the template theme: text/accent/muted colors and the page background.
  const theme = deck.theme ?? DEFAULT_THEME
  colors = themeColors(theme)
  const background = hex(theme.background)

  // Only fetch images for slides whose layout actually shows one (content/list
  // etc. never display an image), then embed the fetched bytes.
  const layoutFor = (slide: ExportSlide) =>
    deck.layouts?.find(l => l.type === slide.layoutType)
  // The background the export actually paints, so a listing's syntax
  // colours are chosen against what a reader will see rather than against
  // whatever the template object happened to say (EXP-7).
  const drawnTheme = { ...deck.templateTheme, background: theme.background }
  const layouts = deck.slides.map(s =>
    computeLayout(s, layoutFor(s), drawnTheme),
  )
  const urls = deck.slides.map((s, i) =>
    layouts[i]!.some(b => b.kind === 'image') ? s.imageRef : undefined,
  )
  const fetched = await fetchSlideImages(urls)
  const images = await Promise.all(
    fetched.map(img =>
      img
        ? img.kind === 'png'
          ? doc.embedPng(img.data)
          : doc.embedJpg(img.data)
        : undefined,
    ),
  )

  // Every distinct formula, typeset and embedded once, before any page is
  // drawn — the page writer is synchronous and typesetting is not.
  const typeset = await typesetFormulas(layouts.flat(), theme.text, notes)
  const formulas = new Map<string, PDFImage>()
  for (const [tex, drawn] of typeset) {
    formulas.set(tex, await doc.embedPng(drawn.png))
  }

  deck.slides.forEach((slide, i) => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: background,
    })
    drawSlide(page, slide, images[i], layoutFor(slide), drawnTheme, formulas)
  })
  if (doc.getPageCount() === 0) {
    doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]).drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: background,
    })
  }

  return doc.save()
}
