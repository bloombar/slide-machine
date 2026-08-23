/**
 * A template's named text styles: what "body" or "heading" means, and about
 * how much text fits a box set in one.
 *
 * Shared rather than client-only because both halves need the same answer.
 * The renderer reads a style to draw a box; the server reads it to tell the
 * AI how much a box holds and to trim what comes back. If those two disagreed,
 * a slide would be generated to one budget and drawn to another.
 *
 * The limits are the sizes the built-in layouts were written around — a
 * heading at 4cqi across most of a slide runs to roughly eighty characters
 * before it wraps past its box. Approximate on purpose: they steer generation
 * rather than police it, and a template may set its own.
 */
import type { TextStyleSpec } from './template'
import { TEXT_STYLE_ROLES } from './template'

export const DEFAULT_TEXT_STYLES: Record<string, TextStyleSpec> = {
  title: { fontSize: 7, fontWeight: 700, maxChars: 60 },
  sectionTitle: { fontSize: 5.5, fontWeight: 600, maxChars: 60 },
  heading: { fontSize: 4, fontWeight: 600, color: 'accent', maxChars: 80 },
  // 1.625 is Tailwind's `leading-relaxed`, which the body text of every
  // built-in layout was written with.
  body: { fontSize: 2.75, lineHeight: 1.625, maxChars: 320 },
  bullet: { fontSize: 2.75, lineHeight: 1.625, maxChars: 90, maxItems: 6 },
  caption: { fontSize: 2, color: 'muted', maxChars: 120 },
  quote: { fontSize: 4, fontWeight: 500, italic: true, maxChars: 200 },
}

/** Every role a template defines, defaults filled in. */
export type ThemeTextStyles = Record<string, TextStyleSpec>

/** One stored role, ignoring anything of the wrong type. Stored themes are
 * free-form, so a bad value must degrade to the default rather than reach the
 * renderer as `NaN`. */
const one = (raw: unknown, fallback: TextStyleSpec): TextStyleSpec => {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v ? v : undefined
  return {
    fontFamily: str(r.fontFamily) ?? fallback.fontFamily,
    fontSize: num(r.fontSize) ?? fallback.fontSize,
    fontWeight: num(r.fontWeight) ?? fallback.fontWeight,
    italic: typeof r.italic === 'boolean' ? r.italic : fallback.italic,
    caps: typeof r.caps === 'boolean' ? r.caps : fallback.caps,
    lineHeight: num(r.lineHeight) ?? fallback.lineHeight,
    color: str(r.color) ?? fallback.color,
    maxChars: num(r.maxChars) ?? fallback.maxChars,
    maxItems: num(r.maxItems) ?? fallback.maxItems,
  }
}

/**
 * Resolves a template's free-form theme into its text styles. Roles the
 * template names itself are kept alongside the conventional ones, so a
 * template may carry styles this build has never heard of.
 */
export const themeTextStyles = (
  theme: Record<string, unknown>,
): ThemeTextStyles => {
  const stored =
    theme.textStyles && typeof theme.textStyles === 'object'
      ? (theme.textStyles as Record<string, unknown>)
      : {}
  const out: ThemeTextStyles = {}
  for (const role of TEXT_STYLE_ROLES)
    out[role] = one(stored[role], DEFAULT_TEXT_STYLES[role] ?? {})
  for (const role of Object.keys(stored))
    if (!out[role]) out[role] = one(stored[role], {})
  return out
}
