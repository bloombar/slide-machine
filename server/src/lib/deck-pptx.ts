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

// pptxgenjs ships as CommonJS; the interop default differs across runtimes
// (bundled vs tsx/native ESM), so resolve the constructor from either shape.
const PptxGenJS = ((
  PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }
).default ?? PptxGenJSImport) as typeof PptxGenJSImport

// 16:9 layout in inches (pptxgenjs default LAYOUT_16x9 = 10 x 5.625).
const SLIDE_W = 10
const SLIDE_H = 5.625
const MARGIN = 0.5

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

/** Fetches a slide image and returns a pptxgenjs data URI, or undefined when it
 * is missing, unfetchable, or an unsupported type. Best-effort. */
const imageData = async (url?: string): Promise<string | undefined> => {
  if (!url || !/^https?:\/\//i.test(url)) return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const type = res.headers.get('content-type') ?? ''
    const mime = /png/i.test(type)
      ? 'image/png'
      : /jpe?g/i.test(type)
        ? 'image/jpeg'
        : /gif/i.test(type)
          ? 'image/gif'
          : ''
    if (!mime) return undefined
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    return `data:${mime};base64,${base64}`
  } catch {
    return undefined
  }
}

/**
 * Builds the deck's .pptx and returns its bytes. Pages are one per deck slide;
 * text flows on the left, with the image (when present) on the right.
 */
export const deckToPptx = async (deck: ExportDeck): Promise<Uint8Array> => {
  const pptx = new PptxGenJS()
  pptx.title = deck.title
  pptx.layout = 'LAYOUT_16x9'

  // Fetch images up front (concurrently).
  const images = await Promise.all(deck.slides.map(s => imageData(s.imageRef)))

  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide()
    const hasImage = Boolean(images[i])
    const textWidth = hasImage ? SLIDE_W * 0.55 - MARGIN : SLIDE_W - MARGIN * 2

    if (slide.title) {
      s.addText(slide.title, {
        x: MARGIN,
        y: MARGIN,
        w: SLIDE_W - MARGIN * 2,
        h: 0.9,
        fontSize: 28,
        bold: true,
        color: '1C2230',
      })
    }

    // Body paragraph, then bullets, as one text block. The run shape is
    // inferred and checked for assignability where it is passed to addText.
    const runs = [
      ...(slide.body
        ? [{ text: slide.body, options: { fontSize: 14, breakLine: true } }]
        : []),
      ...(slide.bullets ?? []).map(bullet => ({
        text: bullet,
        options: { fontSize: 14, bullet: true, breakLine: true },
      })),
    ]
    if (runs.length) {
      s.addText(runs, {
        x: MARGIN,
        y: 1.5,
        w: textWidth,
        h: SLIDE_H - 2.2,
        color: '1C2230',
        valign: 'top',
      })
    }

    if (hasImage) {
      s.addImage({
        data: images[i]!,
        x: SLIDE_W * 0.58,
        y: 1.5,
        w: SLIDE_W * 0.38,
        h: SLIDE_H - 2.2,
        sizing: { type: 'contain', w: SLIDE_W * 0.38, h: SLIDE_H - 2.2 },
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
