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
 */
import PptxGenJSImport from 'pptxgenjs'
import {
  WHITEBOARD_LAYOUT_TYPE,
  themeTextStyles,
  textStylesBySlot,
  type Layout,
  type SlotSpec,
  type Template,
  type ThemeTextStyles,
} from '@slide-machine/shared'
import { resolveTemplateTheme, type ExportTheme } from './deck-theme'

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

/** A colour that may name a theme key (`accent`, `muted`) or be a literal. */
const colorOf = (value: string | undefined, theme: ExportTheme): string => {
  if (!value) return noHash(theme.text)
  const named: Record<string, string | undefined> = {
    accent: theme.accent,
    muted: theme.muted,
    text: theme.text,
    background: theme.background,
  }
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

/** Every box of a layout that has somewhere to sit. A layout with no geometry
 * yields nothing, so it contributes an empty master rather than a wrong one. */
const placedSlots = (
  layout: Layout,
): { spec: SlotSpec; box: { x: number; y: number; w: number; h: number } }[] =>
  layout.slots
    .map(spec => ({ spec, box: layout.elementPositions?.[spec.name] }))
    .filter(
      (s): s is { spec: SlotSpec; box: NonNullable<typeof s.box> } => !!s.box,
    )

/** Where a box sits, in inches. */
const inches = (box: { x: number; y: number; w: number; h: number }) => ({
  x: box.x * SLIDE_W,
  y: box.y * SLIDE_H,
  w: box.w * SLIDE_W,
  h: box.h * SLIDE_H,
})

/** How a box's text is set, from the style its slot follows. */
const textOptions = (
  spec: SlotSpec,
  role: string | undefined,
  styles: ThemeTextStyles,
  theme: ExportTheme,
) => {
  const style = role ? styles[role] : undefined
  return {
    fontSize: (style?.fontSize ?? 2.75) * CQI_TO_PT,
    bold: (style?.fontWeight ?? 400) >= 600,
    italic: style?.italic,
    color: colorOf(style?.color, theme),
    valign: 'top' as const,
  }
}

/**
 * Builds the template's .pptx and returns its bytes: one master per layout,
 * and one demonstration slide on each.
 *
 * The `whiteboard` layout is omitted — it is an app-only blank slate with no
 * visual design to carry, and is re-synthesized on import (TMPL-7).
 */
export const templateToPptx = async (
  template: Template,
): Promise<Uint8Array> => {
  const pptx = new PptxGenJS()
  pptx.title = template.name
  pptx.layout = 'LAYOUT_16x9'

  const theme = resolveTemplateTheme(template.theme)
  const styles = themeTextStyles(template.theme)
  const background = { color: noHash(theme.background) }

  const layouts = template.layouts.filter(
    l => l.type !== WHITEBOARD_LAYOUT_TYPE,
  )

  for (const layout of layouts) {
    const roles = textStylesBySlot(layout)
    const slots = placedSlots(layout)
    const name = masterName(layout)

    // The master: a placeholder per box, which is what makes it a real
    // Slides layout rather than a picture of one.
    pptx.defineSlideMaster({
      title: name,
      background,
      objects: slots.map(({ spec, box }) => ({
        placeholder: {
          options: {
            name: spec.name,
            type: spec.kind === 'image' ? ('pic' as const) : ('body' as const),
            ...inches(box),
            ...(spec.kind === 'image'
              ? {}
              : textOptions(spec, roles[spec.name], styles, theme)),
          },
          // What the box is for, shown until someone types in it. The
          // author's own label, so a layout explains itself in Slides.
          text: spec.label,
        },
      })),
    })

    // The demonstration slide, so the design is visible on open.
    const slide = pptx.addSlide({ masterName: name })
    slide.background = background
    for (const { spec, box } of slots) {
      const at = inches(box)
      if (spec.kind === 'image') {
        // No picture to place, so the box is shown as the reserved space it
        // is — a filled block in the theme's own surface colour.
        slide.addShape(pptx.ShapeType.rect, {
          ...at,
          fill: { color: noHash(theme.muted) },
          line: { type: 'none' },
        })
        continue
      }
      const options = textOptions(spec, roles[spec.name], styles, theme)
      if (spec.kind === 'bullets') {
        slide.addText(
          SAMPLE_BULLETS.map(text => ({
            text,
            options: { bullet: true, breakLine: true },
          })),
          { ...at, ...options },
        )
        continue
      }
      slide.addText(SAMPLE[spec.name] ?? spec.label, { ...at, ...options })
    }
  }

  // A template with only a whiteboard layout would export an empty file,
  // which Drive refuses to convert. One blank slide keeps it a valid
  // presentation the author can still build on.
  if (!layouts.length) {
    const slide = pptx.addSlide()
    slide.background = background
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array
}
