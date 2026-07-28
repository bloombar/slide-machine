/**
 * Renders a slide deck to a PowerPoint (.pptx) document, one slide per deck
 * slide (SPEC EXP-1). This file is not the delivered artifact: it is uploaded
 * to Google Drive with conversion so Drive turns it into a native, editable
 * Google Slides presentation. Building a .pptx (rather than calling the Google
 * Slides API) means Google Slides export needs only the Drive API + `drive.file`
 * scope, both already granted — no separate Slides API or extra OAuth scope.
 *
 * Each slide carries the title, body, and bullet points; when the slide has an
 * image it is embedded (best-effort) with its caption, and the image's TASL
 * attribution/license text is printed small at the foot so downstream copies
 * stay license-compliant. A failed image fetch is skipped, not fatal.
 */
import PptxGenJSImport from 'pptxgenjs'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexForPptx, HIGHLIGHTER_ALPHA } from './deck-drawings'
import { fetchSlideImages, toDataUri } from './deck-image'

// pptxgenjs ships as CommonJS; the interop default differs across runtimes
// (bundled vs tsx/native ESM), so resolve the constructor from either shape.
const PptxGenJS = ((
  PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }
).default ?? PptxGenJSImport) as typeof PptxGenJSImport

// 16:9 layout in inches (pptxgenjs default LAYOUT_16x9 = 10 x 5.625). These
// bands are mirrored 1:1 (×96px) by the PDF export so the two look identical.
const SLIDE_W = 10
const SLIDE_H = 5.625
const MARGIN = 0.5
const BODY_TOP = 1.5
const BODY_HEIGHT = SLIDE_H - 2.2
const IMAGE_X = 5.8
const IMAGE_W = 3.8

/** Assembles the one-line TASL attribution/license credit, or ''. */
const attributionLine = (slide: ExportSlide): string => {
  const a = slide.attribution
  if (!a) return ''
  const parts: string[] = []
  if (a.title) parts.push(`"${a.title}"`)
  if (a.creator) parts.push(`by ${a.creator}`)
  if (a.sourceName) parts.push(`via ${a.sourceName}`)
  if (a.license) parts.push(`— ${a.license}`)
  return parts.join(' ').trim()
}

/**
 * Builds the deck's .pptx and returns its bytes. Pages are one per deck slide;
 * text flows on the left, with the image (when present) on the right.
 */
export const deckToPptx = async (deck: ExportDeck): Promise<Uint8Array> => {
  const pptx = new PptxGenJS()
  pptx.title = deck.title
  pptx.layout = 'LAYOUT_16x9'

  // Fetch images up front (bounded concurrency + retry, shared with the PDF
  // export) and turn each into a data URI for addImage. Missing = skipped.
  const fetched = await fetchSlideImages(deck.slides.map(s => s.imageRef))
  const images = fetched.map(img => (img ? toDataUri(img) : undefined))

  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide()
    const hasImage = Boolean(images[i])
    // Layout bands, kept identical to the PDF export (deck-pdf).
    const textWidth = hasImage ? IMAGE_X - MARGIN - 0.125 : SLIDE_W - MARGIN * 2

    if (slide.title) {
      s.addText(slide.title, {
        x: MARGIN,
        y: MARGIN,
        w: SLIDE_W - MARGIN * 2,
        h: 0.9,
        fontSize: 26,
        bold: true,
        color: '1C2230',
      })
    }

    // Body paragraph, then bullets, as one text block. The run shape is
    // inferred and checked for assignability where it is passed to addText.
    const runs = [
      ...(slide.body
        ? [{ text: slide.body, options: { fontSize: 15, breakLine: true } }]
        : []),
      ...(slide.bullets ?? []).map(bullet => ({
        text: bullet,
        options: { fontSize: 15, bullet: true, breakLine: true },
      })),
    ]
    if (runs.length) {
      s.addText(runs, {
        x: MARGIN,
        y: BODY_TOP,
        w: textWidth,
        h: BODY_HEIGHT,
        color: '1C2230',
        valign: 'top',
      })
    }

    if (hasImage) {
      s.addImage({
        data: images[i]!,
        x: IMAGE_X,
        y: BODY_TOP,
        w: IMAGE_W,
        h: BODY_HEIGHT,
        sizing: { type: 'contain', w: IMAGE_W, h: BODY_HEIGHT },
      })
    }

    // Footer: caption + image attribution/license.
    const footer = [slide.caption, attributionLine(slide)]
      .filter(Boolean)
      .join('  ·  ')
    if (footer) {
      s.addText(footer, {
        x: MARGIN,
        y: SLIDE_H - 0.5,
        w: SLIDE_W - MARGIN * 2,
        h: 0.35,
        fontSize: 8,
        color: '6B7280',
        valign: 'bottom',
      })
    }

    // Freehand whiteboard marks (WB-1) as native freeform lines, on top of the
    // content. Points are normalized 0..1 to the slide, so they scale to inches
    // within the slide (pptx y-axis is top-down, so no flip). Highlighter =
    // partial transparency; a single-point tap = a small filled dot.
    for (const stroke of visibleStrokes(slide.drawings)) {
      const pts = stroke.points
      if (!pts.length) continue
      const color = hexForPptx(stroke.color)
      const widthPt = Math.max(1, stroke.thickness * SLIDE_W * 72)
      const transparency =
        stroke.tool === 'highlighter'
          ? Math.round((1 - HIGHLIGHTER_ALPHA) * 100)
          : 0
      if (pts.length === 1) {
        const d = widthPt / 72
        s.addShape(pptx.ShapeType.ellipse, {
          x: pts[0]!.x * SLIDE_W - d / 2,
          y: pts[0]!.y * SLIDE_H - d / 2,
          w: d,
          h: d,
          fill: { color, transparency },
          line: { type: 'none' },
        })
        continue
      }
      // pptxgenjs 4.x renders custom-geometry freeform lines at runtime, but its
      // type declarations omit the enum member — read the value and cast.
      const customGeom = (pptx.ShapeType as unknown as Record<string, string>)
        .custGeom as Parameters<typeof s.addShape>[0]
      s.addShape(customGeom, {
        x: 0,
        y: 0,
        w: SLIDE_W,
        h: SLIDE_H,
        fill: { type: 'none' },
        line: { color, width: widthPt, transparency },
        points: pts.map((p, i) => ({
          x: p.x * SLIDE_W,
          y: p.y * SLIDE_H,
          ...(i === 0 ? { moveTo: true } : {}),
        })),
      })
    }
  })

  // pptxgenjs returns a Node Buffer for the 'nodebuffer' output type.
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  return new Uint8Array(out)
}
