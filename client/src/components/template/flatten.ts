/**
 * Turning a rendered layout back into absolute geometry.
 *
 * A layout is a tree of flex and grid containers, which is the right way to
 * describe a design and the wrong way to draw one anywhere that cannot run
 * CSS. The PDF, pptx and Google Slides exporters are all in that position
 * (server/src/lib/deck-layout.ts), so on save the editor measures what the
 * browser actually drew and writes it into `elementPositions`, where they
 * already look.
 *
 * The measurement is exact rather than approximate: a slide is always 16:9 and
 * every size in the model is a fraction or a `cqi`, so a layout measured at
 * any width normalizes to the same numbers.
 */
import type { ElementPositions, Layout, SlotBox } from '@slide-machine/shared'
import type { ThemeColors } from '../slide/theme'

/** `#aabbcc` as the `rgb(...)` string a computed style reports, so the two can
 * be compared without a colour library. */
const asRgb = (hex: string): string | undefined => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const n = parseInt(m[1]!, 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/**
 * A colour as the template should store it: the name of the theme entry it
 * matches, or the literal otherwise.
 *
 * Naming it matters — a box that stores `accent` follows the palette when the
 * author recolours the template, and one that stores `rgb(56, 189, 248)` is
 * stuck at the colour it happened to be when it was measured.
 */
const namedColor = (
  computed: string,
  colors: ThemeColors,
): string | undefined => {
  for (const [key, value] of Object.entries(colors))
    if (asRgb(value) === computed) return key
  return computed || undefined
}

/**
 * Brings a measured rectangle inside the slide.
 *
 * What the browser drew and what the geometry schema accepts are not quite
 * the same thing: a picture can paint a pixel past its box, a rounding error
 * can put a right edge at 1.0000001, and the server rejects a box that runs
 * off the slide. Rejecting a whole save because a measurement was a hair out
 * would mean an author's work is refused for a reason they cannot see or fix,
 * so the numbers are fitted rather than trusted.
 */
const fitToSlide = (
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } => {
  const round = (v: number) => Math.round(v * 10000) / 10000
  // Never flush against the far edge: a box has to keep a sliver of width.
  const left = Math.min(0.99, Math.max(0, x))
  const top = Math.min(0.99, Math.max(0, y))
  return {
    x: round(left),
    y: round(top),
    w: round(Math.min(1 - left, Math.max(0.01, w))),
    h: round(Math.min(1 - top, Math.max(0.01, h))),
  }
}

/**
 * Type and alignment as the exporters read them.
 *
 * Geometry alone is not the design: the layouts put their sizes and weights
 * on the box, so copying only x/y/w/h would print a title at body size. Font
 * size converts to `cqi` — a percent of the slide's width — which is the unit
 * `deck-layout.ts` divides by 100 to get back.
 */
const measureType = (
  el: HTMLElement,
  frameWidth: number,
  colors: ThemeColors,
): Partial<SlotBox> => {
  const s = getComputedStyle(el)
  const px = parseFloat(s.fontSize)
  const weight = parseInt(s.fontWeight, 10)
  const out: Partial<SlotBox> = {}
  // Both are bounded the way the schema bounds them, for the same reason the
  // geometry is: a measurement must not be able to refuse a save.
  if (Number.isFinite(px) && px > 0 && frameWidth > 0) {
    const cqi = Math.round((px / frameWidth) * 10000) / 100
    if (cqi > 0) out.fontSize = Math.min(100, cqi)
  }
  if (Number.isFinite(weight) && weight !== 400)
    out.fontWeight = Math.min(
      900,
      Math.max(100, Math.round(weight / 100) * 100),
    )
  if (s.fontStyle === 'italic') out.italic = true
  const color = namedColor(s.color, colors)
  if (color) out.color = color
  if (s.textAlign === 'center' || s.textAlign === 'right')
    out.align = s.textAlign === 'center' ? 'center' : 'end'
  if (s.justifyContent === 'center' || s.justifyContent === 'flex-end')
    out.vAlign = s.justifyContent === 'center' ? 'center' : 'end'
  return out
}

/**
 * Where each slot ended up, as fractions of the canvas.
 *
 * Returns `{}` when the canvas has no size — the layout was never on screen,
 * or this is jsdom, which lays nothing out. A caller must treat that as "no
 * measurement", not as "no boxes", or saving a template whose tab was never
 * opened would erase geometry the exporters rely on.
 */
export const measureSlots = (
  canvas: HTMLElement,
  slideId: string,
  slots: { name: string }[],
  colors: ThemeColors,
): ElementPositions => {
  const frame = canvas.getBoundingClientRect()
  if (!frame.width || !frame.height) return {}

  const out: ElementPositions = {}
  for (const spec of slots) {
    const el = canvas.querySelector<HTMLElement>(
      `[data-flip-id="${CSS.escape(`${slideId}:${spec.name}`)}"]`,
    )
    if (!el) continue
    // The wrapper hugs its content; the box the design reserved is the node
    // the layout placed, which is its parent.
    const cell = el.parentElement ?? el
    const measured = canvas.contains(cell) ? cell : el
    const r = measured.getBoundingClientRect()
    if (!r.width || !r.height) continue
    out[spec.name] = {
      ...fitToSlide(
        (r.left - frame.left) / frame.width,
        (r.top - frame.top) / frame.height,
        r.width / frame.width,
        r.height / frame.height,
      ),
      ...measureType(measured, frame.width, colors),
    }
  }
  return out
}

/**
 * A layout with its geometry brought up to date from the DOM.
 *
 * Keeps the previous boxes when nothing could be measured, so a layout whose
 * tab was never opened is left as it was rather than emptied.
 */
export const flattenLayout = (
  canvas: HTMLElement | null,
  layout: Layout,
  slideId: string,
  colors: ThemeColors,
): Layout => {
  if (!canvas) return layout
  const measured = measureSlots(canvas, slideId, layout.slots, colors)
  if (!Object.keys(measured).length) return layout
  return { ...layout, elementPositions: measured }
}
