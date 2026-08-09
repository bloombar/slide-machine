/**
 * Renders a slide deck to a PowerPoint (.pptx) document, one slide per deck
 * slide (SPEC EXP-1). This file is not the delivered artifact: it is uploaded
 * to Google Drive with conversion so Drive turns it into a native, editable
 * Google Slides presentation. Building a .pptx (rather than calling the Google
 * Slides API) means Google Slides export needs only the Drive API + `drive.file`
 * scope, both already granted — no separate Slides API or extra OAuth scope.
 *
 * Each slide is arranged by its layout type via the shared layout model
 * (deck-layout) that mirrors the app's viewer, so the Slides output matches both
 * the live viewer and the PDF export (which draws from the same model). Freehand
 * whiteboard marks (WB-1) are drawn on top as native freeform shapes. Images are
 * fetched best-effort (shared with the PDF export) and skipped if unavailable.
 */
import PptxGenJSImport from 'pptxgenjs'
import type { Layout } from '@slide-machine/shared'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexForPptx, HIGHLIGHTER_ALPHA } from './deck-drawings'
import { fetchSlideImages, toDataUri } from './deck-image'
import { slotToken } from './slot-metadata'
import { withSlotAltText } from './pptx-alt-text'
import { computeLayout, type ColorRole } from './deck-layout'
import { DEFAULT_THEME } from './deck-theme'

// pptxgenjs ships as CommonJS; the interop default differs across runtimes
// (bundled vs tsx/native ESM), so resolve the constructor from either shape.
const PptxGenJS = ((
  PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }
).default ?? PptxGenJSImport) as typeof PptxGenJSImport

// 16:9 slide in inches (pptxgenjs default LAYOUT_16x9 = 10 x 5.625).
const SLIDE_W = 10
const SLIDE_H = 5.625
// Font sizes are a fraction of slide width; ×72pt/in × 10in = 720 gives points.
const WIDTH_PT = SLIDE_W * 72

/** A pptxgenjs hex color (no leading #, uppercase). */
const noHash = (s: string): string => s.replace(/^#/, '').toUpperCase()

type Pptx = InstanceType<typeof PptxGenJS>
type Slide = ReturnType<Pptx['addSlide']>

/** Draws a slide's layout boxes (text, rule, image) then its whiteboard marks. */
const renderSlide = (
  pptx: Pptx,
  s: Slide,
  slide: ExportSlide,
  hex: Record<ColorRole, string>,
  image?: string,
  layout?: Layout,
): void => {
  for (const box of computeLayout(slide, layout)) {
    if (box.kind === 'text') {
      const runs = box.runs.map(r => ({
        text: r.text,
        options: {
          fontSize: r.sizeFrac * WIDTH_PT,
          bold: r.bold,
          italic: r.italic,
          color: hex[r.color ?? 'ink'],
          bullet: r.bullet,
          breakLine: true,
          paraSpaceAfter: (r.spaceAfterFrac ?? 0) * WIDTH_PT,
        },
      }))
      if (!runs.length) continue
      s.addText(runs, {
        x: box.x * SLIDE_W,
        y: box.y * SLIDE_H,
        w: box.w * SLIDE_W,
        h: box.h * SLIDE_H,
        align: box.align,
        valign: box.valign === 'middle' ? 'middle' : 'top',
        // What this shape IS, so a re-import knows the box without guessing
        // (EXP-8). Only boxes a template named have one.
        ...(box.slot ? { objectName: slotToken(box.slot) } : {}),
      })
    } else if (box.kind === 'rule') {
      s.addShape(pptx.ShapeType.rect, {
        x: box.x * SLIDE_W,
        y: box.y * SLIDE_H,
        w: box.w * SLIDE_W,
        h: box.h * SLIDE_H,
        fill: { color: hex[box.color] },
        line: { type: 'none' },
      })
    } else if (box.kind === 'image' && image) {
      s.addImage({
        data: image,
        ...(box.slot
          ? { objectName: slotToken(box.slot), altText: slotToken(box.slot) }
          : {}),
        x: box.x * SLIDE_W,
        y: box.y * SLIDE_H,
        w: box.w * SLIDE_W,
        h: box.h * SLIDE_H,
        sizing: {
          type: 'contain',
          w: box.w * SLIDE_W,
          h: box.h * SLIDE_H,
        },
      })
    }
  }
  drawStrokes(pptx, s, slide)
}

/** Draws freehand whiteboard marks (WB-1) as native freeform lines. Points are
 * 0..1 of the slide → inches (pptx y-axis is top-down, so no flip). */
const drawStrokes = (pptx: Pptx, s: Slide, slide: ExportSlide): void => {
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
}

/**
 * Builds the deck's .pptx and returns its bytes. One slide per deck slide,
 * arranged by layout type.
 */
export const deckToPptx = async (deck: ExportDeck): Promise<Uint8Array> => {
  const pptx = new PptxGenJS()
  pptx.title = deck.title
  pptx.layout = 'LAYOUT_16x9'

  // Apply the template theme: text/accent/muted colors and the slide background.
  const theme = deck.theme ?? DEFAULT_THEME
  const hex: Record<ColorRole, string> = {
    ink: noHash(theme.text),
    accent: noHash(theme.accent),
    muted: noHash(theme.muted),
  }
  const background = { color: noHash(theme.background) }

  // Only fetch images for slides whose layout shows one; then to data URIs.
  const layoutFor = (slide: ExportSlide) =>
    deck.layouts?.find(l => l.type === slide.layoutType)
  const layouts = deck.slides.map(s => computeLayout(s, layoutFor(s)))
  const urls = deck.slides.map((slide, i) =>
    layouts[i]!.some(b => b.kind === 'image') ? slide.imageRef : undefined,
  )
  const fetched = await fetchSlideImages(urls)
  const images = fetched.map(img => (img ? toDataUri(img) : undefined))

  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide()
    s.background = background
    renderSlide(pptx, s, slide, hex, images[i], layoutFor(slide))
    // The narration goes where a presenter expects to find it, and comes back
    // as narration on re-import (EXP-8/EDIT-6).
    if (slide.narration) s.addNotes(slide.narration)
  })

  // pptxgenjs returns a Node Buffer for the 'nodebuffer' output type.
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  // The generator writes no alt text on a text shape, so it is added after.
  return withSlotAltText(new Uint8Array(out))
}
