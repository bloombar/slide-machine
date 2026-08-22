/**
 * Resolves a template's free-form theme object into the sets the slide
 * renderer and the editor rely on, with safe fallbacks: colors, the spacing
 * metrics the editor lays guides on, and the named text styles layouts refer
 * to by name.
 *
 * The theme is free-form on the wire, so every reader here is a typed getter
 * with a fallback — a template missing a key looks like the defaults rather
 * than like a bug.
 */
export interface ThemeColors {
  background: string
  surface: string
  text: string
  muted: string
  accent: string
  /** Default whiteboard pen color for this template (WB-1): opaque, readable
   * on the background. Falls back to the text color. */
  penColor: string
  /** Default whiteboard highlighter color: rendered semi-transparent. Falls
   * back to the accent color. */
  highlighterColor: string
  /**
   * What is painted behind a picture (TMPL-4).
   *
   * A photograph covers its box and needs nothing behind it, but a diagram,
   * a logo or a chart exported with a transparent ground does: on a pale
   * slide its dark strokes vanish, and on a dark one its dark strokes do.
   * The design says what those pictures sit on, so an instructor dropping a
   * transparent PNG onto a slide gets a readable one without editing it.
   *
   * Transparent unless a template states otherwise, so nothing an existing
   * design draws today moves.
   */
  imageBackground: string
  /**
   * What a hyperlink is drawn in (TMPL-8).
   *
   * A box carries one colour and every run in it is drawn in that one, so an
   * imported deck whose links were red got them in the body's black — the box
   * took its first run's colour. An imported design carries the link colour it
   * states; a template that names none falls back to the accent, which is the
   * colour a template already uses to mean "this one is different".
   */
  link: string
}

const color = (
  theme: Record<string, unknown>,
  key: string,
  fallback: string,
): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : fallback

export const themeColors = (theme: Record<string, unknown>): ThemeColors => {
  const text = color(theme, 'text', '#f1f5f9')
  const accent = color(theme, 'accent', '#38bdf8')
  return {
    background: color(theme, 'background', '#0f172a'),
    surface: color(theme, 'surface', '#1e293b'),
    text,
    muted: color(theme, 'muted', '#94a3b8'),
    accent,
    imageBackground: color(theme, 'imageBackground', 'transparent'),
    penColor: color(theme, 'penColor', text),
    highlighterColor: color(theme, 'highlighterColor', accent),
    link: color(theme, 'link', accent),
  }
}

/** Perceived lightness of a hex colour, 0–1. */
const luminance = (hex: string): number => {
  const v = hex.replace('#', '')
  const full =
    v.length === 3
      ? v
          .split('')
          .map(c => c + c)
          .join('')
      : v
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n) || full.length !== 6) return 1
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255
}

/**
 * What a program listing sits on.
 *
 * The highlighter's colours are built for a dark ground, so the block stays
 * dark whatever the template — but it is the TEMPLATE's dark rather than the
 * highlighter's. Left to itself every deck got GitHub's blue-black, which on
 * a violet-and-white design reads as a screenshot of somebody else's editor
 * rather than as part of the slide.
 *
 * The darkest colour the theme already states is used, so the block belongs
 * to the palette: a near-black on a light design, the surface on a dark one.
 */
export const codeSurface = (colors: ThemeColors): string => {
  const darkest = [colors.surface, colors.text, colors.background]
    .filter(c => typeof c === 'string' && c.startsWith('#'))
    .sort((a, b) => luminance(a) - luminance(b))[0]
  return darkest && luminance(darkest) < 0.45 ? darkest : '#1c1917'
}

/**
 * A template's default spacing, as fractions of the slide.
 *
 * `gap` and `padding` are an **authoring aid**: the editor draws them as
 * guidelines and snaps dragged boxes to them, and nothing on the render path
 * reads them.
 *
 * The margins are not. Every layout whose outermost box states no padding of
 * its own is drawn inside them (`withSafeArea`), which is what gives a
 * template one margin rather than one per layout — so changing a margin does
 * move the slides of decks already made with that template, on purpose.
 */
export interface ThemeMetrics {
  /** Safe area from the left and right edges, 0–1. */
  marginX: number
  /** Safe area from the top and bottom edges, 0–1. */
  marginY: number
  /** Default space between boxes stacked in a new layout, 0–1. */
  gap: number
  /** Advisory inner padding, drawn as a guide only, 0–1. */
  padding: number
}

const metric = (
  theme: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const raw = theme[key]
  // Clamped rather than trusted: a margin over half the slide leaves no
  // safe area at all, and a negative one draws off the edge.
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(0.45, Math.max(0, raw))
}

export const themeMetrics = (theme: Record<string, unknown>): ThemeMetrics => ({
  // The fallbacks reproduce the margins the editor has always seeded a new
  // arrangement with, so a template that never sets them is unchanged.
  marginX: metric(theme, 'marginX', 0.06),
  marginY: metric(theme, 'marginY', 0.06),
  gap: metric(theme, 'gap', 0.03),
  padding: metric(theme, 'padding', 0.02),
})

/**
 * Text styles live in the shared package: the server reads the same answers
 * to tell the AI how much a box holds and to trim what comes back, and a
 * second copy here would let generation and rendering drift apart.
 */
export {
  DEFAULT_TEXT_STYLES,
  themeTextStyles,
  type ThemeTextStyles,
} from '@slide-machine/shared'
