/**
 * Renders a slide deck to a PDF slide deck (SPEC EXP-1): each page is one 16:9
 * landscape slide — one sheet per slide, no cover page — using the SAME layout
 * as the Google Slides export (deck-pptx) so the two match: title top-left,
 * image on the right, body/bullets on the left, caption + image attribution/
 * license at the foot, and any freehand whiteboard marks (WB-1) drawn on top.
 *
 * The PDF is built with `pdf-lib` — pure JS, no native deps. Images are fetched
 * (shared with the Slides export) with bounded concurrency + retry so bulk
 * exports don't rate-limit the image hosts; a still-missing image is skipped.
 */
import {
  PDFDocument,
  StandardFonts,
  LineCapStyle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexToRgb01, HIGHLIGHTER_ALPHA } from './deck-drawings'
import { fetchSlideImages } from './deck-image'

// 16:9 widescreen slide at 96px/inch, so positions map 1:1 from the Slides
// export's inches (10 x 5.625in) — keeping the two layouts identical.
const PX = 96
const PAGE_WIDTH = 10 * PX // 960
const PAGE_HEIGHT = 5.625 * PX // 540
const MARGIN = 0.5 * PX // 48
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

// Layout bands (in px), mirroring deck-pptx exactly.
const TITLE_TOP = 0.5 * PX
const BODY_TOP = 1.5 * PX
const BODY_HEIGHT = PAGE_HEIGHT - 2.2 * PX
const IMAGE_X = 5.8 * PX
const IMAGE_W = 3.8 * PX

const INK = rgb(0.11, 0.13, 0.16)
const MUTED = rgb(0.42, 0.45, 0.5)
const ACCENT = rgb(0.29, 0.33, 0.82)

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

/** Breaks text into lines that fit `maxWidth` at the given font size, honoring
 * any explicit newlines in the source. */
const wrapLines = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
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

/** Assembles the one-line TASL attribution/license credit for an image, or
 * undefined when the slide carries no attribution worth printing. */
const attributionLine = (slide: ExportSlide): string | undefined => {
  const a = slide.attribution
  if (!a) return undefined
  const parts: string[] = []
  if (a.title) parts.push(`"${a.title}"`)
  if (a.creator) parts.push(`by ${a.creator}`)
  if (a.sourceName) parts.push(`via ${a.sourceName}`)
  if (a.license) parts.push(`— ${a.license}`)
  const credit = parts.join(' ').trim()
  return credit || undefined
}

/**
 * Draws the slide's freehand whiteboard marks on top of its content. Stroke
 * points are normalized 0..1 to the slide box, so they map onto the full page
 * (PDF's y-axis is bottom-up, hence `PAGE_HEIGHT - ny*PAGE_HEIGHT`).
 */
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

/** Draws a single slide onto its page: title, image, bullets/body, footer, and
 * any whiteboard marks on top. */
const drawSlide = (
  page: PDFPage,
  slide: ExportSlide,
  fonts: Fonts,
  image?: PDFImage,
): void => {
  // The image sits on the right; text flows in the remaining column.
  const textWidth = image ? IMAGE_X - MARGIN - 12 : CONTENT_WIDTH

  if (slide.title) {
    const size = 26
    let ty = PAGE_HEIGHT - TITLE_TOP - size
    for (const line of wrapLines(
      slide.title,
      fonts.bold,
      size,
      CONTENT_WIDTH,
    )) {
      page.drawText(line, {
        x: MARGIN,
        y: ty,
        size,
        font: fonts.bold,
        color: INK,
      })
      ty -= size + 6
    }
  }

  if (image) {
    const scale = Math.min(IMAGE_W / image.width, BODY_HEIGHT / image.height, 1)
    const w = image.width * scale
    const h = image.height * scale
    page.drawImage(image, {
      x: IMAGE_X + (IMAGE_W - w) / 2,
      y: PAGE_HEIGHT - BODY_TOP - h,
      width: w,
      height: h,
    })
  }

  const bodySize = 15
  let y = PAGE_HEIGHT - BODY_TOP - bodySize
  const drawParagraph = (text: string, prefix = '') => {
    for (const [i, line] of wrapLines(
      text,
      fonts.regular,
      bodySize,
      textWidth - (prefix ? 18 : 0),
    ).entries()) {
      if (i === 0 && prefix) {
        page.drawText(prefix, {
          x: MARGIN,
          y,
          size: bodySize,
          font: fonts.bold,
          color: ACCENT,
        })
      }
      page.drawText(line, {
        x: MARGIN + (prefix ? 18 : 0),
        y,
        size: bodySize,
        font: fonts.regular,
        color: INK,
      })
      y -= bodySize + 7
    }
  }

  if (slide.body) {
    drawParagraph(slide.body)
    y -= 6
  }
  for (const bullet of slide.bullets ?? []) {
    drawParagraph(bullet, '•')
  }

  // Footer: caption + image attribution/license.
  const footerLines: string[] = []
  if (slide.caption) footerLines.push(slide.caption)
  const credit = attributionLine(slide)
  if (credit) footerLines.push(credit)
  let fy = MARGIN + footerLines.length * 12
  for (const line of footerLines) {
    for (const wrapped of wrapLines(line, fonts.regular, 8, CONTENT_WIDTH)) {
      page.drawText(wrapped, {
        x: MARGIN,
        y: fy,
        size: 8,
        font: fonts.regular,
        color: MUTED,
      })
      fy -= 11
    }
  }

  // Whiteboard marks last, so they sit on top of the slide content.
  drawStrokes(page, slide)
}

/**
 * Builds the deck's PDF and returns its bytes: one 16:9 page per slide, in
 * display order (no cover page — one sheet per slide).
 */
export const deckToPdf = async (deck: ExportDeck): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.setTitle(deck.title)
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  // Fetch every slide image up front (bounded concurrency + retry), then embed
  // them (local, fast). Missing/failed images are simply skipped.
  const fetched = await fetchSlideImages(deck.slides.map(s => s.imageRef))
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
    drawSlide(doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), slide, fonts, images[i])
  })
  // A valid PDF needs at least one page; an empty deck gets a blank one.
  if (doc.getPageCount() === 0) doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  return doc.save()
}
