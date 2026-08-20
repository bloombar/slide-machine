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
import type { ExportNote } from '@slide-machine/shared'
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { visibleStrokes, hexForPptx, HIGHLIGHTER_ALPHA } from './deck-drawings'
import { defineLayoutMasters } from './template-pptx'
import { creditToken, CREDIT_LINE_TOKEN } from './image-attribution-token'
import { fetchSlideImages, toDataUri } from './deck-image'
import { slotToken } from './slot-metadata'
import { typesetFormulas, type Formulas } from './deck-formulas'
import { withSlotAltText } from './pptx-alt-text'
import { computeLayout, type ColorRole, type TextBox } from './deck-layout'
import { DEFAULT_THEME } from './deck-theme'
import { fitScale, estimatedHeight } from './fit-scale'
import { tableTracks } from '@slide-machine/shared'
import { pptxFace } from './export-fonts'

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

/**
 * How much to shrink a text box's type so it fits the box (EXP-1).
 *
 * PowerPoint wraps the text, not us, so unlike the PDF there is nothing here
 * to measure — the height is estimated from the box's width and what it holds.
 * A slide is asked for at one aspect, so everything is worked in fractions of
 * the slide's width, the unit the type sizes already come in.
 *
 * Estimated rather than measured, and so approximate. `fit: 'shrink'` on the
 * shape asks PowerPoint to do the exact thing with its own metrics — but only
 * once the box is edited or resized, which is no help to someone opening the
 * file to read it. This gets the first look close; PowerPoint refines it after.
 */
const fitFor = (box: TextBox): number => {
  // Lines, as PowerPoint will break them: a run continues the previous line
  // unless it asked for a break.
  const lines: string[] = []
  for (const run of box.runs) {
    if (run.sameLine && lines.length) lines[lines.length - 1] += run.text
    else lines.push(run.text)
  }
  // The largest size in the box, since the shrink applies to all of it and the
  // biggest run is what decides whether it overflows.
  const size = Math.max(0, ...box.runs.map(r => r.sizeFrac))
  const gaps = box.runs.reduce((sum, r) => sum + (r.spaceAfterFrac ?? 0), 0)
  // Box height in width-fractions, to match the type sizes.
  const height = box.h * (SLIDE_H / SLIDE_W)
  return fitScale(
    at => estimatedHeight(lines, size * at, box.w) + gaps * at,
    height,
  )
}

/** Draws a slide's layout boxes (text, rule, image) then its whiteboard marks. */
const renderSlide = (
  pptx: Pptx,
  s: Slide,
  slide: ExportSlide,
  hex: Record<ColorRole, string>,
  image?: string,
  layout?: Layout,
  templateTheme?: Record<string, unknown>,
  formulas?: Formulas,
  /**
   * Fill the layout's placeholders instead of drawing boxes over them
   * (EXP-1's "deck carrying reusable layouts").
   *
   * A slide that drew its own boxes on top of a master would leave the
   * master's empty ones behind it, so every box would appear twice — and a
   * re-import would read the leftovers as part of the design.
   */
  intoPlaceholders = false,
): void => {
  for (const box of computeLayout(slide, layout, templateTheme)) {
    if (box.kind === 'text') {
      const scale = fitFor(box)
      const runs = box.runs.map((r, i) => ({
        text: r.text,
        options: {
          fontSize: r.sizeFrac * scale * WIDTH_PT,
          bold: r.bold,
          italic: r.italic,
          // A syntax token's own colour wins over the slide's three roles
          // (EXP-7); everything else is drawn in the role it asked for.
          color: r.hex ? noHash(r.hex) : hex[r.color ?? 'ink'],
          bullet: r.bullet,
          // A listing keeps its indentation because the face is monospaced
          // and nothing reflows it; anything else is set in the nearest face
          // to the stack the design asked for (TMPL-8), so an imported deck
          // exports in the kind of type it was designed in.
          ...(r.mono
            ? { fontFace: 'Courier New' }
            : pptxFace(r.family)
              ? { fontFace: pptxFace(r.family)! }
              : {}),
          /*
           * Coloured pieces of one line come back together as that line.
           *
           * pptx breaks AFTER a run, and `sameLine` says a run continues the
           * one before it — so the question is about the NEXT run, not this
           * one. Read off this run, a marker asked for a break straight after
           * itself: "1." sat alone on its line, its words fell to the next,
           * and the following marker landed on the end of them.
           */
          breakLine: !box.runs[i + 1]?.sameLine,
          // A link is content (EXP-5): an imported slide whose only address
          // was inside one exported unreachable.
          ...(r.link ? { hyperlink: { url: r.link } } : {}),
          // A sub-point is drawn as one, rather than level with its parent.
          ...(r.indent ? { indentLevel: r.indent } : {}),
          paraSpaceAfter: (r.spaceAfterFrac ?? 0) * scale * WIDTH_PT,
        },
      }))
      if (!runs.length) continue
      s.addText(runs, {
        // Into the layout's box where there is one, so the design stays the
        // layout's and the slide is only its words.
        ...(intoPlaceholders && box.slot
          ? { placeholder: box.slot }
          : {
              x: box.x * SLIDE_W,
              y: box.y * SLIDE_H,
              w: box.w * SLIDE_W,
              h: box.h * SLIDE_H,
            }),
        align: box.align,
        valign: box.valign === 'middle' ? 'middle' : 'top',
        // PowerPoint's own shrink-to-fit, with its own font metrics, for
        // anything the estimate above got slightly wrong. It only recomputes
        // on an edit, which is why the type is pre-shrunk too.
        fit: 'shrink',
        // What this shape IS, so a re-import knows the box without guessing
        // (EXP-8). Only boxes a template named have one.
        ...(box.slot ? { objectName: slotToken(box.slot) } : {}),
        // A printed credit is named as one, so a re-import leaves it on the
        // page rather than reading it back as a caption nobody wrote
        // (IMG-5). The provenance itself rides on the picture's alt text.
        ...(box.credit ? { objectName: CREDIT_LINE_TOKEN } : {}),
      })
    } else if (box.kind === 'rule') {
      s.addShape(pptx.ShapeType.rect, {
        x: box.x * SLIDE_W,
        y: box.y * SLIDE_H,
        w: box.w * SLIDE_W,
        h: box.h * SLIDE_H,
        // The colour the design names, where it names one (TMPL-8): an
        // imported band is whatever it was drawn, not one of three roles.
        fill: { color: box.hex ? noHash(box.hex) : hex[box.color] },
        line: { type: 'none' },
      })
    } else if (box.kind === 'math') {
      // Typeset, never written out: a formula exported as its LaTeX makes a
      // maths lecture unusable, which is the whole point of the kind (EXP-7).
      const drawn = formulas?.get(box.tex)
      if (!drawn) continue
      const fit = contain(box, drawn.aspect)
      s.addImage({
        data: `data:image/png;base64,${Buffer.from(drawn.png).toString('base64')}`,
        ...fit,
        ...(box.slot
          ? { objectName: slotToken(box.slot), altText: box.tex }
          : { altText: box.tex }),
      })
    } else if (box.kind === 'table') {
      // A real table, because pptx has one: Slides and PowerPoint both give
      // it rows a reader can select and a screen reader can announce.
      const body = box.rows.map(row =>
        row.map(text => ({ text, options: { color: hex.ink } })),
      )
      const rows = box.header?.length
        ? [
            box.header.map(text => ({
              text,
              options: { bold: true, color: hex.ink },
            })),
            ...body,
          ]
        : body
      if (rows.length) {
        const columns = Math.max(...rows.map(r => r.length), 1)
        const w = box.w * SLIDE_W
        const h = box.h * SLIDE_H
        s.addTable(rows, {
          x: box.x * SLIDE_W,
          y: box.y * SLIDE_H,
          w,
          h,
          // The proportions the table was given (EDIT-7), in inches, since
          // pptx wants sizes and not fractions. Without these pptxgenjs
          // divides the box equally, which is what every table used to get.
          colW: tableTracks(box.colWidths, columns).map(f => f * w),
          rowH: tableTracks(box.rowHeights, rows.length).map(f => f * h),
          fontSize: TABLE_PT,
          border: { type: 'solid', pt: 0.5, color: hex.muted },
          ...(box.slot ? { objectName: slotToken(box.slot) } : {}),
        })
      }
    } else if (box.kind === 'image' && image) {
      // Alt text carries the picture's provenance home (IMG-5/EXP-8): neither
      // Slides nor PowerPoint has a field for it, and a deck exported, edited
      // there and imported back came home with anonymous pictures.
      const token = creditToken(slide.attribution)
      const alt = [box.slot ? slotToken(box.slot) : undefined, token]
        .filter(Boolean)
        .join('\n')
      s.addImage({
        data: image,
        ...(box.slot ? { objectName: slotToken(box.slot) } : {}),
        ...(alt ? { altText: alt } : {}),
        // Named AND positioned, unlike the text above: naming it makes the
        // picture the content of the layout's picture box, which is what
        // Slides' own "apply layout" and a re-import both read. The explicit
        // size stays because `sizing` is what fits a picture of unknown
        // proportions into that space without distorting it.
        ...(intoPlaceholders && box.slot ? { placeholder: box.slot } : {}),
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

/**
 * A picture centred in its box at its own proportions.
 *
 * `sizing: contain` would do this for a photograph, but a formula's box is
 * the space the design reserved and the formula is usually far wider than it
 * is tall — letting it fill the box would stretch the notation.
 */
const contain = (
  box: { x: number; y: number; w: number; h: number },
  aspect: number,
) => {
  const boxW = box.w * SLIDE_W
  const boxH = box.h * SLIDE_H
  const w = Math.min(boxW, boxH * aspect)
  const h = w / aspect
  return {
    x: box.x * SLIDE_W + (boxW - w) / 2,
    y: box.y * SLIDE_H + (boxH - h) / 2,
    w,
    h,
  }
}

/** Table type, in points. Smaller than body text: a table is read a cell at
 * a time and packs more into the same box. */
const TABLE_PT = 12

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
export const deckToPptx = async (
  deck: ExportDeck,
  /** Collects what a format could not carry, for the export's report
   * (EXP-7). */
  notes?: ExportNote[],
  /**
   * Carry the deck's style template as the presentation's own layouts, and
   * attach each slide to the one it uses (EXP-1).
   *
   * Off by default, which is the spec's default: a flat deck is the right
   * answer for handing someone a finished lecture — nothing to maintain,
   * nothing to break. On, for continuing to work in Google Slides or
   * re-importing later: without layout pages a re-import has nothing to
   * group by, so it clusters the slides and derives a design of its own, and
   * the lecture comes back looking rearranged.
   */
  withLayouts = false,
): Promise<Uint8Array> => {
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
  // The background the export actually paints, so a listing's syntax
  // colours are chosen against what a reader will see rather than against
  // whatever the template object happened to say (EXP-7).
  const drawnTheme = { ...deck.templateTheme, background: theme.background }
  const layouts = deck.slides.map(s =>
    computeLayout(s, layoutFor(s), drawnTheme),
  )
  const urls = deck.slides.map((slide, i) =>
    layouts[i]!.some(b => b.kind === 'image') ? slide.imageRef : undefined,
  )
  const fetched = await fetchSlideImages(urls)
  const images = fetched.map(img => (img ? toDataUri(img) : undefined))
  // Every distinct formula, typeset once, before any slide is drawn.
  const formulas = await typesetFormulas(layouts.flat(), theme.text, notes)

  // The layouts the deck is drawn with, written as the presentation's own —
  // so the file carries the design rather than a copy of it per slide.
  const masters = withLayouts
    ? defineLayoutMasters(
        pptx,
        { layouts: deck.layouts ?? [], theme: deck.templateTheme ?? {} },
        {
          ...theme,
          // The same rule the design export uses, so one template renders the
          // same colours whichever door the file comes out of.
          surface:
            typeof deck.templateTheme?.surface === 'string'
              ? deck.templateTheme.surface
              : theme.background,
        },
        background,
      )
    : new Map<string, string>()

  deck.slides.forEach((slide, i) => {
    const master = masters.get(slide.layoutType)
    const s = master ? pptx.addSlide({ masterName: master }) : pptx.addSlide()
    s.background = background
    renderSlide(
      pptx,
      s,
      slide,
      hex,
      images[i],
      layoutFor(slide),
      drawnTheme,
      formulas,
      // Fills the layout's boxes when there is one to fill, so the design
      // stays on the layout and the slide carries only its content.
      Boolean(master),
    )
    // The narration goes where a presenter expects to find it, and comes back
    // as narration on re-import (EXP-8/EDIT-6).
    if (slide.narration) s.addNotes(slide.narration)
  })

  // pptxgenjs returns a Node Buffer for the 'nodebuffer' output type.
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  // The generator writes no alt text on a text shape, so it is added after.
  return withSlotAltText(new Uint8Array(out))
}
