/**
 * Turning a box's declared style into CSS.
 *
 * One module because two things read it and must not drift: the renderers
 * that draw a slide, and the editor's flattener, which measures what they drew
 * to produce the absolute geometry the exporters use. If they disagreed, a
 * slide would export as something other than what it looks like.
 *
 * Sizes arrive in `cqi` — a percent of the slide's width — so type and spacing
 * scale with the slide rather than the window (docs/TEMPLATES.md §4).
 */
import type { BoxStyle } from '@slide-machine/shared'
import type { ThemeColors } from '../theme'
import type { ThemeTextStyles } from '../theme'
import { fontStack } from '../fonts'

/** A box's color is either a theme key, so a template's palette stays the
 * single source of truth, or a literal the author chose. */
export const resolveColor = (
  color: string | undefined,
  colors: ThemeColors,
): string | undefined => {
  if (!color) return undefined
  return color in colors ? colors[color as keyof ThemeColors] : color
}

/** How a box may be aligned, on either axis. */
type Alignment = NonNullable<BoxStyle['align']>

/**
 * Flex alignment for a box's own content.
 *
 * Typed as a TOTAL record over the three values rather than as
 * `Record<string, string>`, and that is the point rather than tidiness: the
 * defect this file carried was an enum property handled by a conditional on
 * one of its values instead of by a map with an entry for each. A total
 * record cannot be written with a value missing — it fails to compile — so
 * the class of defect goes away instead of being covered by a test.
 */
export const FLEX: Record<Alignment, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
}

/** The same three values as text alignment, which places the LINES inside
 * the block that `FLEX` places. Total, for the reason above. */
const TEXT_ALIGN: Record<Alignment, 'start' | 'center' | 'end'> = {
  start: 'start',
  center: 'center',
  end: 'end',
}

/**
 * A box's effective style: the named text role it follows, with any field it
 * sets itself layered on top. Naming a role and then overriding one thing is
 * the common case, so the cascade is one merge rather than a mode switch.
 */
export const resolveStyle = (
  style: BoxStyle | undefined,
  textStyles: ThemeTextStyles,
): BoxStyle => {
  if (!style) return {}
  const role = style.textStyle ? textStyles[style.textStyle] : undefined
  if (!role) return style
  // `style` last: an explicit field on the box beats what the role supplies.
  // Undefined entries are dropped first, or they would erase the role.
  const own = Object.fromEntries(
    Object.entries(style).filter(([, v]) => v !== undefined),
  )
  return { ...role, ...own }
}

/** Type and color, shared by every box that holds content. */
export const typeStyle = (
  style: BoxStyle,
  colors: ThemeColors,
): React.CSSProperties => ({
  // Against `--fit-scale`, which is 1 unless a box had to shrink to show
  // everything it holds (`useFitText`). A box that never overflows renders
  // exactly the size its design asked for.
  fontSize: style.fontSize
    ? `calc(var(--fit-scale, 1) * ${style.fontSize}cqi)`
    : undefined,
  fontWeight: style.fontWeight,
  fontStyle: style.italic ? 'italic' : undefined,
  // A transform, never a change to the text. The slide stores what the author
  // wrote and the box draws it shouted (`BoxStyle.caps`).
  textTransform: style.caps ? 'uppercase' : undefined,
  lineHeight: style.lineHeight,
  fontFamily: fontStack(style.fontFamily),
  color: resolveColor(style.color, colors),
  /**
   * A word longer than its box breaks rather than bursting it.
   *
   * Slide text ran on the CSS default, `overflow-wrap: normal`, under which a
   * token with no break opportunity cannot be broken at all — so the box grew
   * to whatever width the token demanded. A title holding one long word came
   * out over half again the width of the slide, hanging off BOTH edges with
   * its start and end cut by the slide boundary. Every design the app ships
   * did it, byte for byte identically, because it was never a property of any
   * template.
   *
   * `anywhere` rather than `break-word`: both break the word visually, but
   * only `anywhere` also constrains the box's `min-content` width, and the
   * symptom here is the BOX growing. `break-word` would break the glyphs and
   * leave the geometry exactly as wrong as it was.
   *
   * It also makes the renderer agree with the arithmetic. The capacity
   * estimate assumes text wraps wherever it must (`text-metrics`), and a
   * budget saying a word fits is only true if the renderer will break it.
   * A URL, a file path, a chemical name or a gene identifier all reach this,
   * and a lecture is exactly where those appear.
   */
  overflowWrap: 'anywhere',
})

const pad = (v: number | undefined): string | undefined =>
  v ? `${v}cqi` : undefined

/** Fill, border and padding — everything that makes a box a visible surface
 * rather than just a place text sits. */
export const surfaceStyle = (
  style: BoxStyle,
  colors: ThemeColors,
): React.CSSProperties => ({
  backgroundColor: resolveColor(style.background, colors),
  // Written as four longhands rather than the `padding` shorthand: a per-axis
  // value then simply wins over the uniform one, with no shorthand ordering
  // to reason about.
  paddingLeft: pad(style.paddingX ?? style.padding),
  paddingRight: pad(style.paddingX ?? style.padding),
  paddingTop: pad(style.paddingY ?? style.padding),
  paddingBottom: pad(style.paddingY ?? style.padding),
  borderRadius: style.radius ? `${style.radius}cqi` : undefined,
  borderWidth: style.borderWidth ? `${style.borderWidth}cqi` : undefined,
  borderStyle: style.borderWidth ? 'solid' : undefined,
  borderColor: resolveColor(style.borderColor, colors),
})

/**
 * The full style for a box that lays its content out itself: a flex column,
 * so `align` and `vAlign` mean the same thing in every renderer.
 */
export const contentStyle = (
  style: BoxStyle,
  colors: ThemeColors,
): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: FLEX[style.vAlign ?? 'start'],
  alignItems: FLEX[style.align ?? 'start'],
  /*
   * Every value of `align`, not only the middle one.
   *
   * `alignItems` above places the text BLOCK, and that is not the same
   * property: a right-ranged block of several lines still sets each of its
   * lines from the left unless the text itself is told otherwise. So a
   * design whose title is ranged right — which is how NYU Bold sets its
   * list titles, and which the template records correctly — drew with four
   * ragged right edges and one hard left one, and nothing could see it.
   * The data audit passes because the data is right, and the clip, bounds
   * and overlap rules pass because the geometry is right: the box is in the
   * correct place at the correct size holding the correct words, and the
   * design is still wrong.
   *
   * Logical values rather than `left`/`right`, matching the logical
   * properties the slot markup already uses (`ps-`, `text-start`), so a
   * right-to-left language ranges to the correct edge.
   */
  textAlign: TEXT_ALIGN[style.align ?? 'start'],
  ...typeStyle(style, colors),
  ...surfaceStyle(style, colors),
})
