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

/** Flex alignment for a box's own content. */
export const FLEX: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
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
  fontSize: style.fontSize ? `${style.fontSize}cqi` : undefined,
  fontWeight: style.fontWeight,
  fontStyle: style.italic ? 'italic' : undefined,
  lineHeight: style.lineHeight,
  fontFamily: fontStack(style.fontFamily),
  color: resolveColor(style.color, colors),
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
  textAlign: style.align === 'center' ? 'center' : undefined,
  ...typeStyle(style, colors),
  ...surfaceStyle(style, colors),
})
