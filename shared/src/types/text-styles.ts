/**
 * The line box a face occupies when nothing asks it to be tighter.
 *
 * Two things read it. Google states leading as a percentage OF NORMAL, so
 * `lineSpacing: 80` is 80% of this rather than 0.8 (`lineHeightFrom`). And a
 * box led TIGHTER than this does not shrink its glyphs to match — the ink
 * stays this tall and hangs outside the line box, which a clipped box cuts.
 *
 * MEASURED, NOT COMPUTED: 1.19602 ± 0.00061, precision-weighted over five
 * cases. Live renders of the NYU Bold source deck, read as baseline-to-
 * baseline distance off per-row ink profiles — Google outlines the glyphs in
 * its embed, so there is no text node to ask and pixels were the only
 * instrument. The scale is arithmetic rather than an estimate: the deck's
 * `pageSize` is 9144000 EMU, which is 10in at 720pt, captured 4800px wide, so
 * 6.6667 px/pt exactly.
 *
 * A round 1.200 sits 6.6σ away, and it is the RESIDUALS that say so rather
 * than the mean: at 1.200 all three large-type cases miss the same way (1.9,
 * 1.2 and 1.5px), which is a systematic error, while the two 12pt cases sit
 * at zero because one pixel is 0.83% of a line at that size and they cannot
 * discriminate at all. At 1.196 every residual is under half a pixel with no
 * sign pattern.
 *
 * One case was measured and DISCARDED: slide 6's quote gave unequal band
 * heights, a Q's tail contaminating the bottom edge and a round cap
 * overshooting the top, and it would have supported anything from 1.198 to
 * 1.205 depending on which edge you believed. Unequal bands are the tell that
 * a band is not measuring what you think it is. That it was excluded, and
 * why, is part of why the other five are believable.
 *
 * A FONT-METRICS DERIVATION GIVES ~1.219 AND IS WRONG. Montserrat's own
 * ascent and descent put its normal line box there, and two people deriving
 * that independently is the same assumption twice rather than a confirmation.
 * The large-type cases exclude it outright. Do not "correct" this back to a
 * computed figure.
 *
 * OPEN, AND STATED AS OPEN: every one of those measurements is Google
 * rendering Montserrat. Whether this is a property of Google's interpretation
 * or varies by typeface cannot be settled from one face, and settling it
 * would take the same measurement on an import set in another. An unproven
 * constant with an honest docstring is fine; the figure this replaces was a
 * confident sentence about source data nobody had checked.
 */

/**
 */
export const NATURAL_LINE_BOX = 1.196

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
