/**
 * Where a box's INK is, as opposed to where its rectangle is.
 *
 * Shared because this codebase had three different answers to one question
 * and they disagreed. The template audit compared element rectangles; the
 * rendered check in `e2e/tests/slide-boxes.ts` compared line boxes, which is
 * what `Range.getBoundingClientRect()` returns; and the ink itself was
 * measured only once, by hand, in a probe that lived nowhere. Two rules that
 * disagree about what "overlap" means will disagree about whether a design is
 * broken, and both will be confident.
 *
 * ## Why the rectangle is the wrong thing to compare
 *
 * NYU Bold's section divider is the case that forced this. Its title box and
 * its numeral box overlap over 6.1% of the slide — genuinely, in the source
 * deck, as NYU drew it — and the glyphs clear each other by 0.062 of the
 * slide's height, about a third of the title's own type size. A rule reading
 * rectangles calls a correct design broken.
 *
 * The line box is no better, and it is wrong in OPPOSITE directions on the
 * two boxes of that one slide: the title is led at 0.957, below the face's
 * natural box, so its glyphs hang OUTSIDE their line boxes; the numeral is
 * led at 1.196, so its glyphs sit comfortably INSIDE. Comparing line boxes
 * overstates one and understates the other.
 *
 * ## What "the ink" means here, and what it does not
 *
 * A rule has to hold for whatever an author writes, and a template does not
 * record what its slots will hold. The extents below are therefore measured
 * over letters and digits — but the glyph set is the implementation, not the
 * claim. Stated as something a reader can actually check, what this rule
 * assumes about any pair of boxes it calls clear is:
 *
 *   **the upper box's last line carries no deep descender, AND the lower box
 *   holds digits.**
 *
 * On NYU Bold's divider, which is the case that forced this, both halves are
 * within a few pixels of mattering. Montserrat Bold's deepest capital is `Q`
 * at 0.161em — 14.8px as that slide renders — against 1.1px for `C`, `G` and
 * `J`, so it is a cliff rather than a slope: one letter, or none. Above it,
 * the dot on an `i` or `j` reaches 0.787em. A `Q` in the title over an `i` in
 * the numeral leaves about 5px of real ink in a gap this rule calls clear
 * (measured twice, from the metrics and from a render, at 5.0 and 5.2px).
 *
 * Describing that as "unaccented Latin" would send a reader looking for
 * accents, and accents are not what breaks it. **Marks are.** Admit them and
 * the title's deepest glyph is `@` at 19.0px while the numeral's tallest is
 * the solidus at 285.3px, which touch by 28px — five times the residual
 * above. The character-set framing does not cover its own worst case, which
 * is why the assumption is written as the two conditions rather than as a
 * repertoire.
 *
 * The second condition — that the lower box holds digits — is the one nothing
 * enforces. It is true of this divider because the slot is a part number, and
 * it is exactly what **TMPL-16** proposes: a slot declaring the characters it
 * holds. Implement TMPL-16 and this rule reads the declaration instead of
 * assuming it, and the solidus case closes with it. Do not widen the extents
 * here to cover marks; that builds the approximation deeper rather than
 * replacing it.
 *
 * This is the same standard TMPL-12 already sets for character WIDTHS — "a
 * statement about content of ordinary letter widths rather than a guarantee
 * that no string of that length can ever shrink a box" — applied to heights.
 * It is only acceptable while it stays this loud.
 *
 * ## The one inference this makes about content
 *
 * A box drawn with `caps` cannot receive a lowercase descender, because
 * `text-transform: uppercase` is applied by CSS to whatever arrives — so the
 * reachable set really is the uppercased one, and using it is reading the
 * design rather than guessing at the content. That is the whole distinction:
 * a box's `caps` flag is enforced, while its label and description are prose
 * nobody checks. Inferring "this slot holds digits" from a slot called
 * "Part number" would be the second thing wearing the clothes of the first.
 *
 * ## Only the faces we ship
 *
 * Ink is a property of a typeface, and the app bundles two. Every other font
 * stack names families that happen to be on the reader's machine, whose
 * metrics are unknowable from here. For those, `inkBoxOf` returns null and
 * the caller keeps whatever it did before — the same shape as the character
 * width table, which measures the faces we ship and falls back elsewhere.
 *
 * The numbers come from the font files themselves and can be re-derived with
 * `node scripts/font-ink-metrics.mjs`.
 */
import { NATURAL_LINE_BOX } from './text-styles'

/** A 16:9 slide is this many `cqi` tall — `cqi` being a percent of its
 * WIDTH, which is the unit templates measure type in. */
export const SLIDE_H_CQI = 56.25

/** How far a set of glyphs reaches from the baseline, in ems. */
export interface InkSpan {
  /** Above the baseline: the tallest glyph in the set. */
  above: number
  /** Below it: the deepest. */
  below: number
}

/** One weight of one bundled face. */
interface FaceInk {
  /** From `hhea` — the box a browser centres inside the line box. */
  ascender: number
  descender: number
  /** Unaccented letters and digits, as written. */
  text: InkSpan
  /** The same set uppercased, for a box set in capitals. */
  caps: InkSpan
}

/**
 * Measured, not chosen — `scripts/font-ink-metrics.mjs` prints this table.
 *
 * Keyed by the font-stack key a template stores, then by weight. Only two
 * weights: a design asking for 600 gets the 700 file, which is what the
 * bundle actually serves.
 */
const FACE_INK: Record<string, Record<400 | 700, FaceInk>> = {
  montserrat: {
    400: {
      ascender: 0.968,
      descender: 0.251,
      text: { above: 0.747, below: 0.199 },
      caps: { above: 0.706, below: 0.139 },
    },
    700: {
      ascender: 0.968,
      descender: 0.251,
      text: { above: 0.787, below: 0.202 },
      caps: { above: 0.712, below: 0.161 },
    },
  },
  'frank-ruhl-libre': {
    400: {
      ascender: 0.957,
      descender: 0.334,
      text: { above: 0.705, below: 0.212 },
      caps: { above: 0.684, below: 0.21 },
    },
    700: {
      ascender: 0.957,
      descender: 0.334,
      text: { above: 0.704, below: 0.212 },
      caps: { above: 0.686, below: 0.211 },
    },
  },
}

/** How a box is set, in the fields that decide where its ink lands. */
export interface InkStyle {
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  lineHeight?: number
  caps?: boolean
  vAlign?: 'start' | 'center' | 'end'
  padding?: number
  paddingY?: number
}

/** A rectangle in slide fractions, the way a template states one. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const faceFor = (style: InkStyle): FaceInk | undefined => {
  const family = style.fontFamily
  if (!family) return undefined
  const weights = FACE_INK[family]
  if (!weights) return undefined
  return (style.fontWeight ?? 400) >= 600 ? weights[700] : weights[400]
}

/**
 * The leading this box is actually drawn at, or null for a face we have no
 * metrics for.
 *
 * Exported because the caller counts the lines and this rule places them, and
 * a box counted at one leading and placed at another would be measured
 * against a slide nobody draws. No stated leading means CSS `normal`, which
 * is the face's own box rather than 1.
 */
export const lineHeightOf = (style: InkStyle): number | null => {
  const face = faceFor(style)
  if (!face) return null
  return style.lineHeight ?? face.ascender + face.descender
}

/**
 * The rectangle this box's glyphs can actually occupy, or null when the face
 * is one we have no metrics for.
 *
 * `lines` is how many lines the box can show — the caller's business, since
 * the server derives it from the box's own geometry and the browser can read
 * it off what was drawn.
 *
 * Full width, deliberately. Text can range anywhere across its box depending
 * on what is written, so narrowing the ink horizontally would be a guess
 * about content of exactly the kind the docstring above refuses.
 */
export const inkBoxOf = (
  box: Rect,
  style: InkStyle,
  lines: number,
): Rect | null => {
  const face = faceFor(style)
  const fontSize = style.fontSize
  if (!face || !fontSize || lines < 1) return null

  const faceBox = face.ascender + face.descender
  // No stated leading means CSS `normal`, which IS the face's own box.
  const lineHeight = style.lineHeight ?? faceBox
  const span = style.caps ? face.caps : face.text

  // The renderer's own overhang padding: a box led tighter than the natural
  // line box gets half the overhang at each end, unless it states padding of
  // its own (`boxStyle.overhangPadding`).
  const pad =
    lineHeight < NATURAL_LINE_BOX &&
    style.paddingY === undefined &&
    style.padding === undefined
      ? (NATURAL_LINE_BOX - lineHeight) / 2
      : 0

  const contentEm = (box.h * SLIDE_H_CQI) / fontSize - 2 * pad
  const blockEm = lines * lineHeight
  const vAlign = style.vAlign ?? 'start'
  const slack =
    vAlign === 'center'
      ? (contentEm - blockEm) / 2
      : vAlign === 'end'
        ? contentEm - blockEm
        : 0

  // Where the first baseline lands: the line box's own half-leading, then the
  // face's ascent. A face whose box exceeds the leading has NEGATIVE
  // half-leading, which is exactly how tight display type hangs above its
  // first line.
  const first =
    pad + Math.max(0, slack) + (lineHeight - faceBox) / 2 + face.ascender
  const last = first + (lines - 1) * lineHeight

  const toSlide = (em: number) => (em * fontSize) / SLIDE_H_CQI
  const top = box.y + toSlide(first - span.above)
  const bottom = box.y + toSlide(last + span.below)
  return { x: box.x, y: top, w: box.w, h: bottom - top }
}
