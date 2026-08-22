/**
 * A style template as a .pptx whose SLIDE MASTERS are the template's layouts
 * (EXP-6).
 *
 * Google Slides has no template file type — a template there is simply a
 * presentation whose layouts define a design, which is what a user copies and
 * builds on. So exporting a template means producing exactly that.
 *
 * It goes through pptx rather than the Slides API because the Slides API
 * cannot *create* masters or layouts, only apply ones a presentation already
 * has. Drive's existing pptx→Slides conversion turns each master into a native
 * Slides layout, which is also why this needs no OAuth scope beyond the one
 * already used to create files (docs/TEMPLATES.md §8).
 *
 * Each layout contributes two things: a master carrying its geometry and
 * styling, and one demonstration slide on that master, so the design is
 * visible the moment the file opens rather than being an empty deck of
 * invisible placeholders.
 *
 * ## Where the geometry comes from
 *
 * A layout is a tree of containers, and `elementPositions` holds absolute
 * boxes only once the editor has had that layout on screen and measured it.
 * Every built-in carries none, so reading it alone would export a deck of
 * blank slides in the template's background colour. The tree is resolved here
 * instead (`tree-boxes.ts`) — the same order the renderer picks in — and
 * measured geometry is used only for a layout that has no tree, which is what
 * a design imported from Slides is (TMPL-8).
 */
import PptxGenJSImport from 'pptxgenjs'
import {
  WHITEBOARD_LAYOUT_TYPE,
  themeTextStyles,
  type BoxStyle,
  type Layout,
  type SlotSpec,
  type Template,
} from '@slide-machine/shared'
import { resolveTemplateTheme, type ExportTheme } from './deck-theme'
import { resolveTreeBoxes, type ResolvedBox } from './tree-boxes'
import { fetchSlideImages, toDataUri } from './deck-image'
import { textStylesBySlot } from '@slide-machine/shared'
import { encodeSlotMetadata, slotToken } from './slot-metadata'
import { withSlotAltText } from './pptx-alt-text'
import { pptxFontFace } from './pptx-fonts'
import { previewImageUrls } from '../enrichment/preview-images'

// pptxgenjs ships CJS; the default export is the constructor under ESM.
const PptxGenJS = ((
  PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }
).default ?? PptxGenJSImport) as typeof PptxGenJSImport

// 16:9 in inches, matching the deck exporter so both read the same geometry.
const SLIDE_W = 10
const SLIDE_H = 5.625
/** Font sizes are `cqi` — a percent of slide WIDTH — and a point is 1/72in. */
const CQI_TO_PT = (SLIDE_W * 72) / 100

const noHash = (s: string): string => s.replace(/^#/, '').toUpperCase()

/** The colours a box may name, beyond the four an export theme carries. */
interface Palette extends ExportTheme {
  surface: string
}

/** A colour that may name a theme entry (`accent`, `muted`) or be a literal. */
const colorOf = (
  value: string | undefined,
  palette: Palette,
  fallback: string,
): string => {
  if (!value) return noHash(fallback)
  const named = palette as unknown as Record<string, string | undefined>
  return noHash(named[value] ?? value)
}

/**
 * A master name Slides will show as the layout's name. Uppercased because
 * pptx master names are conventionally so, and the layout's own label is what
 * the author called it.
 */
const masterName = (layout: Layout): string =>
  (layout.label || layout.type).toUpperCase()

/** Sample text for a demonstration slide — enough to show the type and
 * spacing, short enough not to overflow a small box. */
const SAMPLE: Record<string, string> = {
  title: 'A slide in this style',
  body: 'A sentence or two of body text, so the type and spacing show at a glance.',
  caption: 'A caption',
}
const SAMPLE_BULLETS = ['A first point', 'A second point', 'A third point']

/** What a demonstration slide shows in a box, one entry per paragraph. This is
 * also what the layout is measured against, so the boxes it reserves are the
 * boxes this text sits in. */
const sampleLines =
  (layout: Layout) =>
  (name: string): string[] => {
    const spec = layout.slots.find(s => s.name === name)
    if (spec?.kind === 'image') return []
    if (spec?.kind === 'bullets') return SAMPLE_BULLETS
    return [SAMPLE[name] ?? spec?.label ?? name]
  }

/** Where a box sits, in inches. */
const inches = (box: { x: number; y: number; w: number; h: number }) => ({
  x: box.x * SLIDE_W,
  y: box.y * SLIDE_H,
  w: box.w * SLIDE_W,
  h: box.h * SLIDE_H,
})

const H_ALIGN = { start: 'left', center: 'center', end: 'right' } as const
const V_ALIGN = { start: 'top', center: 'middle', end: 'bottom' } as const

/** How a box's text is set, from the style in force on it. */
const textOptions = (style: BoxStyle, palette: Palette) => ({
  fontSize: (style.fontSize ?? 2.75) * CQI_TO_PT,
  // The design's typeface, named as something PowerPoint has. Left unset the
  // file gets Calibri whatever the template said, which is why an exported
  // design came back close but never quite itself.
  ...(pptxFontFace(style.fontFamily)
    ? { fontFace: pptxFontFace(style.fontFamily) }
    : {}),
  bold: (style.fontWeight ?? 400) >= 600,
  italic: style.italic,
  color: colorOf(style.color, palette, palette.text),
  align: H_ALIGN[style.align ?? 'start'],
  valign: V_ALIGN[style.vAlign ?? 'start'],
  // The renderer draws text tight to its box; pptx pads by default, which
  // would shift every line in from where the design put it.
  margin: 0,
})

/**
 * The boxes a layout draws, in paint order.
 *
 * The tree is the design and is resolved without a browser. A layout with no
 * tree at all is bare geometry — an imported design — and is drawn from the
 * boxes it carries.
 */
const boxesOf = (layout: Layout, theme: Record<string, unknown>) => {
  // A layout the author built has a tree, and the tree is what it IS: the
  // boxes are derived from it by measuring, so resolving it again is exact.
  //
  // A layout imported from Slides has no tree — it arrived as absolute
  // geometry (TMPL-8) — and `resolveTreeBoxes` answers anyway, by inventing
  // a default tree from the slot names. Letting that win exported every
  // imported design in generic positions: the right boxes, in places the
  // deck never put them. Measured geometry is the design wherever there is
  // no tree, so it is asked first.
  const measured = layout.elementPositions ?? {}
  const hasMeasured = Object.keys(measured).length > 0
  if (layout.tree || !hasMeasured) {
    const resolved = resolveTreeBoxes(layout, theme, sampleLines(layout))
    if (resolved.length) return resolved
  }

  // Measured geometry answers for the slots it covers, and the tree answers
  // for the rest. Neither alone is enough: taking only the tree put an
  // imported design in generic positions, and taking only the measurements
  // dropped every slot that was never measured — a picture box among them,
  // which is how an export lost its images.
  const textStyles = themeTextStyles(theme)
  const fromTree = resolveTreeBoxes(layout, theme, sampleLines(layout))
  const unmeasured = fromTree.filter(box => !box.slot || !measured[box.slot])

  return [
    ...layout.slots.flatMap((spec: SlotSpec): ResolvedBox[] => {
      const box = measured[spec.name]
      if (!box) return []
      const { x, y, w, h, ...style } = box
      return [
        {
          node: { id: spec.name, slot: spec.name },
          slot: spec.name,
          kind: spec.kind,
          style: style.textStyle
            ? { ...textStyles[style.textStyle], ...style }
            : style,
          x,
          y,
          w,
          h,
        },
      ]
    }),
    ...unmeasured,
  ]
}

/**
 * Where a layout's slot metadata rides: one shape of its own, off the slide
 * and empty, whose alt text is the versioned payload (EXP-8).
 *
 * It is a shape rather than the speaker notes because notes exist only on
 * slides. A template's metadata belongs to its LAYOUTS — that is the whole
 * point of carrying it — and layouts have no notes to put it in.
 *
 * Off the canvas so nothing is drawn over the design, and empty so there is
 * nothing to read even if someone finds it.
 */
const metadataObject = (layout: Layout) => {
  // With the role each box follows, read from wherever the layout keeps it —
  // its tree, or its geometry for an imported design. Every shape is written
  // in literal type below, so this payload is the only place the reference
  // itself survives the trip (TMPL-9).
  const payload = encodeSlotMetadata(layout.slots, textStylesBySlot(layout))
  if (!payload) return []
  return [
    {
      text: {
        text: '',
        options: {
          x: SLIDE_W + 0.5,
          y: 0,
          w: 0.05,
          h: 0.05,
          // The payload is the shape's name, which `withSlotAltText` copies
          // into its description — the field Google keeps and shows nowhere.
          objectName: payload,
        },
      },
    },
  ]
}

/** The words a demonstration slide puts in a box, with whatever literal
 * characters the layout prints around them (the quote layout's marks). */
const demoText = (box: ResolvedBox, layout: Layout): string => {
  const body = sampleLines(layout)(box.slot!).join(' ')
  return `${box.node.before ?? ''}${body}${box.node.after ?? ''}`
}

/**
 * Defines one pptx master per layout a template declares, and says what each
 * is called.
 *
 * Shared by both exporters. A design export ([EXP-6](../../docs/SPEC.md))
 * writes these and shows each on a demonstration slide; a lecture export
 * carrying reusable layouts (EXP-1) writes the same ones and attaches its
 * real slides to them. One implementation, because two would drift and a
 * re-import would then depend on which door the file came out of.
 *
 * The master holds the whole design — decoration, reserved picture space, and
 * a placeholder per box. Everything a slide should show without being asked
 * is inherited from here rather than repeated on every slide, which is what
 * makes the layouts reusable when the file is opened or re-imported (TMPL-8).
 *
 * The `whiteboard` layout gets none — it is an app-only blank slate with no
 * visual design to carry, and is re-synthesized on import (TMPL-7).
 */
export const defineLayoutMasters = (
  pptx: InstanceType<typeof PptxGenJS>,
  template: Pick<Template, 'layouts' | 'theme'>,
  palette: Palette,
  background: { color: string },
): Map<string, string> => {
  const names = new Map<string, string>()
  const layouts = (template.layouts ?? []).filter(
    l => l.type !== WHITEBOARD_LAYOUT_TYPE,
  )
  for (const layout of layouts) {
    const boxes = boxesOf(layout, template.theme ?? {})
    const name = masterName(layout)
    const decoration = boxes.filter(box => !box.slot)
    const slots = boxes.filter(box => !!box.slot)
    // The layout holds the whole design: the decoration and the reserved
    // space for pictures first, then a placeholder per box over the top. Only
    // the placeholders are the author's to type in, and everything a slide
    // using this layout should show without being asked is inherited from
    // here rather than repeated on every slide.
    pptx.defineSlideMaster({
      title: name,
      background,
      objects: [
        ...decoration.map(box => ({
          rect: {
            ...inches(box),
            fill: {
              color: colorOf(box.style.background, palette, palette.accent),
            },
            line: { type: 'none' as const },
          },
        })),
        // A picture box shows as the space it reserves, so a layout with an
        // empty picture in it still reads as the design it is.
        ...slots
          .filter(box => box.kind === 'image')
          .map(box => ({
            rect: {
              ...inches(box),
              fill: { color: noHash(palette.muted) },
              line: { type: 'none' as const },
            },
          })),
        ...metadataObject(layout),
        ...slots.map(box => ({
          placeholder: {
            options: {
              name: box.slot!,
              type: box.kind === 'image' ? ('pic' as const) : ('body' as const),
              ...inches(box),
              ...(box.kind === 'image' ? {} : textOptions(box.style, palette)),
              ...(box.kind === 'bullets' ? { bullet: true } : {}),
              // What this shape IS, so a re-import restores the slot rather
              // than inferring one from the rectangle (EXP-8).
              objectName: slotToken(box.slot!),
            },
            // What the box is for, shown until someone types in it — the
            // author's own label, so a layout explains itself in Slides.
            text:
              layout.slots.find(s => s.name === box.slot)?.label ?? box.slot!,
          },
        })),
      ],
    })
    names.set(layout.type, name)
  }
  return names
}

/**
 * Builds the template's .pptx and returns its bytes: one master per layout,
 * and one demonstration slide on each.
 *
 * `pictures` are `data:` URIs to stand in the picture boxes of the
 * demonstration slides, taken in turn and repeated if there are more boxes
 * than pictures (`templatePictures`). They go on the slides and never into a
 * layout: a layout carrying a photograph would bake it into every slide made
 * from it, which is a design nobody chose. Without any, a picture box shows
 * as the space it reserves.
 *
 * The `whiteboard` layout is omitted — it is an app-only blank slate with no
 * visual design to carry, and is re-synthesized on import (TMPL-7).
 */
export const templateToPptx = async (
  template: Template,
  pictures: string[] = [],
): Promise<Uint8Array> => {
  const pptx = new PptxGenJS()
  pptx.title = template.name
  pptx.layout = 'LAYOUT_16x9'

  const theme = resolveTemplateTheme(template.theme)
  const palette: Palette = {
    ...theme,
    surface:
      typeof template.theme?.surface === 'string'
        ? (template.theme.surface as string)
        : theme.background,
  }
  const background = { color: noHash(theme.background) }

  const layouts = template.layouts.filter(
    l => l.type !== WHITEBOARD_LAYOUT_TYPE,
  )
  // Taken in turn across the whole file, so a design with several picture
  // boxes shows several different pictures rather than the same one twice.
  let taken = 0
  const nextPicture = (): string | undefined =>
    pictures.length ? pictures[taken++ % pictures.length] : undefined

  defineLayoutMasters(pptx, template, palette, background)

  for (const layout of layouts) {
    const boxes = boxesOf(layout, template.theme ?? {})
    const name = masterName(layout)
    const slots = boxes.filter(box => !!box.slot)

    // The demonstration slide, so the design is visible the moment the file
    // opens. Its text goes INTO the layout's placeholders: a slide that drew
    // its own boxes instead would leave the layout's empty ones behind it,
    // and every box would appear twice.
    const slide = pptx.addSlide({ masterName: name })
    slide.background = background
    for (const box of slots) {
      if (box.kind === 'image') {
        const picture = nextPicture()
        if (!picture) {
          // Claims the placeholder and leaves it empty, which is what a
          // picture nobody has chosen yet looks like.
          slide.addText('', {
            placeholder: box.slot,
            objectName: slotToken(box.slot!),
          })
          continue
        }
        // Fills the placeholder rather than sitting over it, so the box is
        // still the layout's box and appears once.
        slide.addImage({
          placeholder: box.slot,
          objectName: slotToken(box.slot!),
          altText: slotToken(box.slot!),
          data: picture,
          ...inches(box),
          // Kept in proportion inside the box the design drew, as a slide's
          // own pictures are.
          sizing: {
            type: 'contain',
            w: box.w * SLIDE_W,
            h: box.h * SLIDE_H,
          },
        })
        continue
      }
      if (box.kind === 'bullets') {
        slide.addText(
          SAMPLE_BULLETS.map(text => ({
            text,
            options: { bullet: true, breakLine: true },
          })),
          { placeholder: box.slot, objectName: slotToken(box.slot!) },
        )
        continue
      }
      slide.addText(demoText(box, layout), {
        placeholder: box.slot,
        objectName: slotToken(box.slot!),
      })
    }
  }

  // A template with only a whiteboard layout would export an empty file,
  // which Drive refuses to convert. One blank slide keeps it a valid
  // presentation the author can still build on.
  if (!layouts.length) {
    const slide = pptx.addSlide()
    slide.background = background
  }

  const bytes = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array
  // The generator writes no alt text on a text shape, so it is added after.
  return withSlotAltText(bytes)
}

/**
 * Stand-in pictures for a template's picture boxes, as `data:` URIs.
 *
 * The same placeholder set the editor fills a layout's picture boxes with
 * while an author works, so an exported design shows what the author was
 * looking at rather than grey rectangles. Nobody chose these pictures and
 * nothing keeps them: they illustrate the demonstration slides and are not
 * part of the design (`preview-images.ts`).
 *
 * Never fatal. An image host that is slow, blocked, or absent costs the export
 * its illustrations, not the export itself.
 */
export const templatePictures = async (
  template: Pick<Template, 'layouts'>,
): Promise<string[]> => {
  const wanted = template.layouts
    .filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
    .reduce((n, l) => n + l.slots.filter(s => s.kind === 'image').length, 0)
  if (!wanted) return []
  try {
    const urls = await previewImageUrls(undefined, wanted)
    const fetched = await fetchSlideImages(urls)
    return fetched.filter(Boolean).map(image => toDataUri(image!))
  } catch {
    return []
  }
}
