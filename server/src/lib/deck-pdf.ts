/**
 * Renders a slide deck to a PDF slide deck (SPEC EXP-1): each page is one 16:9
 * landscape slide — the same widescreen shape as the Google Slides export — so
 * the PDF reads as a real deck, one slide per sheet. Each page carries the
 * slide's title, body, and bullet points; when the slide has an image it is
 * embedded (best-effort) with its caption, and the image's TASL attribution/
 * license text is printed at the foot so downstream copies stay license-
 * compliant. Freehand whiteboard marks (WB-1) are drawn on top when included.
 *
 * The PDF is built with `pdf-lib` — pure JS, no native deps — so generation is
 * deterministic and unit-testable. Remote image fetches are best-effort: a
 * failed or unsupported image is skipped rather than failing the whole export.
 */
import {
  PDFDocument,
  StandardFonts,
  LineCapStyle,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexToRgb01, HIGHLIGHTER_ALPHA } from './deck-drawings'

// 16:9 widescreen slide (13.33in x 7.5in at 72dpi), matching Google Slides.
const PAGE_WIDTH = 960
const PAGE_HEIGHT = 540
const MARGIN = 56
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const INK = rgb(0.11, 0.13, 0.16)
const MUTED = rgb(0.42, 0.45, 0.5)
const ACCENT = rgb(0.29, 0.33, 0.82)

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

/** Fetches and embeds a slide's image into the document, returning the embedded
 * image, or undefined if it is missing, unfetchable, or an unsupported type. */
const embedImage = async (doc: PDFDocument, url?: string) => {
  if (!url || !/^https?:\/\//i.test(url)) return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const type = res.headers.get('content-type') ?? ''
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (/png/i.test(type)) return await doc.embedPng(bytes)
    if (/jpe?g/i.test(type)) return await doc.embedJpg(bytes)
    return undefined
  } catch {
    return undefined
  }
}

/** Draws the deck's cover page: its title, centered, over an accent rule. */
const drawCover = (page: PDFPage, title: string, fonts: Fonts): void => {
  const size = 40
  const lines = wrapLines(title, fonts.bold, size, CONTENT_WIDTH)
  let y = PAGE_HEIGHT / 2 + (lines.length * (size + 8)) / 2
  for (const line of lines) {
    const width = fonts.bold.widthOfTextAtSize(line, size)
    page.drawText(line, {
      x: (PAGE_WIDTH - width) / 2,
      y,
      size,
      font: fonts.bold,
      color: INK,
    })
    y -= size + 8
  }
  page.drawRectangle({
    x: (PAGE_WIDTH - 140) / 2,
    y: y - 10,
    width: 140,
    height: 3,
    color: ACCENT,
  })
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
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
  index: number,
  fonts: Fonts,
  image?: Awaited<ReturnType<typeof embedImage>>,
): void => {
  let y = PAGE_HEIGHT - MARGIN

  if (slide.title) {
    const size = 30
    for (const line of wrapLines(
      slide.title,
      fonts.bold,
      size,
      CONTENT_WIDTH,
    )) {
      page.drawText(line, {
        x: MARGIN,
        y: y - size,
        size,
        font: fonts.bold,
        color: INK,
      })
      y -= size + 8
    }
    y -= 14
  }

  // The image sits on the right; text flows in the remaining column.
  let textWidth = CONTENT_WIDTH
  if (image) {
    const maxW = CONTENT_WIDTH * 0.42
    const maxH = y - MARGIN - 48
    const scale = Math.min(maxW / image.width, maxH / image.height, 1)
    const w = image.width * scale
    const h = image.height * scale
    page.drawImage(image, {
      x: PAGE_WIDTH - MARGIN - w,
      y: y - h,
      width: w,
      height: h,
    })
    textWidth = CONTENT_WIDTH - w - 28
  }

  const bodySize = 16
  const drawParagraph = (text: string, prefix = '') => {
    const lines = wrapLines(
      text,
      fonts.regular,
      bodySize,
      textWidth - (prefix ? 20 : 0),
    )
    lines.forEach((line, i) => {
      const label = i === 0 ? prefix : ''
      if (label) {
        page.drawText(label, {
          x: MARGIN,
          y: y - bodySize,
          size: bodySize,
          font: fonts.bold,
          color: ACCENT,
        })
      }
      page.drawText(line, {
        x: MARGIN + (prefix ? 20 : 0),
        y: y - bodySize,
        size: bodySize,
        font: fonts.regular,
        color: INK,
      })
      y -= bodySize + 8
    })
  }

  if (slide.body) {
    drawParagraph(slide.body)
    y -= 8
  }
  for (const bullet of slide.bullets ?? []) {
    drawParagraph(bullet, '•')
  }

  // Footer: caption + image attribution/license, then the slide number.
  const footerLines: string[] = []
  if (slide.caption) footerLines.push(slide.caption)
  const credit = attributionLine(slide)
  if (credit) footerLines.push(credit)
  let fy = MARGIN + footerLines.length * 13
  for (const line of footerLines) {
    for (const wrapped of wrapLines(line, fonts.regular, 9, CONTENT_WIDTH)) {
      page.drawText(wrapped, {
        x: MARGIN,
        y: fy,
        size: 9,
        font: fonts.regular,
        color: MUTED,
      })
      fy -= 12
    }
  }
  page.drawText(String(index + 1), {
    x: PAGE_WIDTH - MARGIN - 10,
    y: MARGIN - 22,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  })

  // Whiteboard marks last, so they sit on top of the slide content.
  drawStrokes(page, slide)
}

/**
 * Builds the deck's PDF and returns its bytes. Pages are: a cover naming the
 * deck, then one 16:9 slide per page in display order.
 */
export const deckToPdf = async (deck: ExportDeck): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.setTitle(deck.title)
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  drawCover(doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), deck.title, fonts)

  // Embed images up front (concurrently) so page drawing stays synchronous.
  const images = await Promise.all(
    deck.slides.map(slide => embedImage(doc, slide.imageRef)),
  )
  deck.slides.forEach((slide, i) => {
    drawSlide(
      doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      slide,
      i,
      fonts,
      images[i],
    )
  })

  return doc.save()
}
