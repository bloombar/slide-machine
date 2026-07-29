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
  StandardFonts,
  LineCapStyle,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexToRgb01, HIGHLIGHTER_ALPHA } from './deck-drawings'
import { fetchSlideImages } from './deck-image'
import { DEFAULT_THEME, type ExportTheme } from './deck-theme'
import {
  computeLayout,
  type ColorRole,
  type LayoutRun,
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
}

const fontFor = (fonts: Fonts, run: LayoutRun): PDFFont =>
  run.bold ? fonts.bold : run.italic ? fonts.italic : fonts.regular

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

interface DrawnLine {
  text: string
  size: number
  font: PDFFont
  color: Color
  gapAfter: number
}

/** Lays a text box's runs into wrapped lines and draws them, honoring the box's
 * horizontal align and vertical align (top or middle) — the app's flex/justify. */
const drawTextBox = (page: PDFPage, box: TextBox): void => {
  const bw = box.w * PAGE_WIDTH
  const bxLeft = box.x * PAGE_WIDTH
  const boxTop = PAGE_HEIGHT - box.y * PAGE_HEIGHT
  const bh = box.h * PAGE_HEIGHT

  const drawn: DrawnLine[] = []
  let totalH = 0
  for (const run of box.runs) {
    const size = run.sizeFrac * PAGE_WIDTH
    const font = fontFor(fonts, run)
    const color = colors[run.color ?? 'ink']
    const text = (run.bullet ? '•  ' : '') + run.text
    const lineH = size * 1.32
    const wrapped = wrapLines(text, font, size, bw)
    wrapped.forEach((t, i) => {
      drawn.push({
        text: t,
        size,
        font,
        color,
        gapAfter:
          i === wrapped.length - 1 ? (run.spaceAfterFrac ?? 0) * PAGE_WIDTH : 0,
      })
      totalH += lineH
    })
    totalH += (run.spaceAfterFrac ?? 0) * PAGE_WIDTH
  }

  let cursorTop = box.valign === 'middle' ? boxTop - (bh - totalH) / 2 : boxTop
  for (const ln of drawn) {
    const lineH = ln.size * 1.32
    const lineW = ln.font.widthOfTextAtSize(ln.text, ln.size)
    const x = box.align === 'center' ? bxLeft + (bw - lineW) / 2 : bxLeft
    page.drawText(ln.text, {
      x,
      y: cursorTop - ln.size,
      size: ln.size,
      font: ln.font,
      color: ln.color,
    })
    cursorTop -= lineH + ln.gapAfter
  }
}

// Set per document (embedded fonts are document-scoped; colors are per deck).
let fonts: Fonts
let colors: Record<ColorRole, Color> = themeColors(DEFAULT_THEME)

/** Draws a slide's boxes (image, rule, text) then its whiteboard marks. */
const drawSlide = (
  page: PDFPage,
  slide: ExportSlide,
  image?: PDFImage,
): void => {
  for (const box of computeLayout(slide)) {
    if (box.kind === 'text') {
      drawTextBox(page, box)
    } else if (box.kind === 'rule') {
      page.drawRectangle({
        x: box.x * PAGE_WIDTH,
        y: PAGE_HEIGHT - box.y * PAGE_HEIGHT - box.h * PAGE_HEIGHT,
        width: box.w * PAGE_WIDTH,
        height: box.h * PAGE_HEIGHT,
        color: colors[box.color],
      })
    } else if (box.kind === 'image' && image) {
      const bw = box.w * PAGE_WIDTH
      const bh = box.h * PAGE_HEIGHT
      const scale = Math.min(bw / image.width, bh / image.height) // contain
      const w = image.width * scale
      const h = image.height * scale
      const boxTop = PAGE_HEIGHT - box.y * PAGE_HEIGHT
      page.drawImage(image, {
        x: box.x * PAGE_WIDTH + (bw - w) / 2,
        y: boxTop - (bh - h) / 2 - h,
        width: w,
        height: h,
      })
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
export const deckToPdf = async (deck: ExportDeck): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.setTitle(deck.title)
  fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }
  // Apply the template theme: text/accent/muted colors and the page background.
  const theme = deck.theme ?? DEFAULT_THEME
  colors = themeColors(theme)
  const background = hex(theme.background)

  // Only fetch images for slides whose layout actually shows one (content/list
  // etc. never display an image), then embed the fetched bytes.
  const layouts = deck.slides.map(computeLayout)
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

  deck.slides.forEach((slide, i) => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: background,
    })
    drawSlide(page, slide, images[i])
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
