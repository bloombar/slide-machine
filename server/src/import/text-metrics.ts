/**
 * How much text a box holds, estimated from its geometry (TMPL-8).
 *
 * There is no browser on the server, so an imported box is measured
 * arithmetically: how many characters fit across its width at its type size,
 * times how many lines fit down its height. Crude, and deliberately generous
 * — being a little wrong about a box with room beneath it costs nothing,
 * while being too small costs the reader the end of every list.
 *
 * Shared by the two readers that must agree on it: `build-template`, which
 * gives a box room for what it holds and bounds what may be written into it,
 * and `type-scale`, which gives each derived text role a budget from the
 * boxes that follow it. Two copies of this arithmetic would be two answers to
 * "how much fits", which is the question the whole generation contract rests
 * on.
 */
import type { CandidateSlot } from './candidate'

/**
 * A character's width, as a fraction of the type size, PER FACE.
 *
 * This was a single 0.5 for every typeface, and measuring it showed the
 * assumption was wrong in both directions at once. Body prose at weight 400,
 * measured per face:
 *
 *   sans 0.429 · humanist 0.440 · frank-ruhl-libre 0.454 · serif 0.454
 *   geometric 0.466 · montserrat 0.522 · mono 0.602
 *
 * A forty percent spread, so no single number can be right. Five faces were
 * given less room than they have, and text was trimmed shorter than it needed
 * to be. Montserrat and especially MONO went the other way: a monospaced face
 * has no narrow letters at all, so a program listing — the one box where
 * overflow is least forgivable — was told it holds a fifth more than it does.
 */
const CHAR_W: Record<string, number> = {
  sans: 0.429,
  humanist: 0.44,
  'frank-ruhl-libre': 0.454,
  serif: 0.454,
  geometric: 0.466,
  montserrat: 0.522,
  mono: 0.602,
}

/**
 * For a face nobody measured, or none stated.
 *
 * Wider than every measured face except Montserrat and mono, which is the
 * safe direction: it under-states what a box holds, so text is written a
 * little short rather than a little over. `condensed` and `handwritten` land
 * here and are genuinely narrower than this, so they lose a few characters
 * they could have had — the trade being that a face nobody has measured
 * never overflows on our estimate.
 */
const CHAR_W_DEFAULT = 0.5

/**
 * The same, for a box set in capitals. Measured, not derived.
 *
 * This was a single ratio applied to the table above, and that was wrong in
 * principle rather than merely imprecise. Measured per face, capitals run
 * between 1.22 and 1.35 times the width of prose — and MONO is exactly 1.000,
 * as it has to be: every glyph in a monospaced face has the same advance, so
 * no multiplier can be right for it.
 *
 * The ratio was also too small, and too small is the unsafe direction: it
 * makes the estimate think more characters fit than do, so the budget is
 * generous and capitals overflow their box. It came out low because the
 * figure it was derived from compared capitals against TITLE CASE rather than
 * prose, and Title Case already capitalises every word's first letter, so it
 * sits much nearer all-caps than prose does. On Montserrat: prose 0.522,
 * Title Case 0.540, capitals 0.637 — caps over Title Case is 1.179, caps over
 * prose is 1.220. The old 1.16 was very nearly the Title-Case ratio, which is
 * the tell that it was measuring the wrong pair.
 *
 * Both tables are measurements now, and that is worth stating because the
 * test over them went red twice while nothing was wrong with what it tested.
 * It had taken one figure from a measurement and the other from a multiplier
 * applied to it — and a check that mixes a measurement with a model moves
 * every time the model does.
 */
const CHAR_W_CAPS: Record<string, number> = {
  sans: 0.555,
  humanist: 0.572,
  geometric: 0.6,
  serif: 0.612,
  condensed: 0.505,
  montserrat: 0.637,
  'frank-ruhl-libre': 0.563,
  mono: 0.602,
}

/**
 * Capitals in a face nobody measured.
 *
 * The TOP of the observed range rather than its middle, for the same reason
 * the mixed-case fallback is wider than most of its table: over-stating how
 * wide capitals are makes a title come out short, and under-stating it makes
 * a title overflow. Short is the recoverable one.
 */
const CHAR_W_CAPS_DEFAULT = CHAR_W_DEFAULT * 1.35

/**
 * A line's full height, as a fraction of the type size.
 *
 * Only the fallback now. A box set in a role that states its own
 * `lineHeight` is measured against THAT: a display face at 0.95 fits half
 * again as many lines into the same box as this assumes, and a paragraph at
 * 1.625 fits fewer. Guessing 1.5 for both is how a title box was told it
 * holds one line when it holds two.
 */
const LINE_H = 1.5
/** A 16:9 slide is this many `cqi` tall — `cqi` being a percent of its WIDTH. */
const SLIDE_H_CQI = 56.25

/** The most `maxItems` the template schema will take. */
const MAX_ITEMS = 50

/** What one character of this box costs, in fractions of its type size. */
const charWidthFor = (setting: {
  caps?: boolean
  fontFamily?: string
}): number => {
  const table = setting.caps ? CHAR_W_CAPS : CHAR_W
  const fallback = setting.caps ? CHAR_W_CAPS_DEFAULT : CHAR_W_DEFAULT
  return (
    (setting.fontFamily ? table[setting.fontFamily] : undefined) ?? fallback
  )
}

/**
 * The height a box's own content needs, as a fraction of the slide's height.
 * Zero when nothing is known about what it holds.
 *
 * An estimate — there is no browser here — and deliberately a generous one.
 * Being a little taller than needed costs nothing on a box with space beneath
 * it; being too short costs the reader the end of every list.
 */
export const heightForText = (
  slot: CandidateSlot,
  setting: { lineHeight?: number; caps?: boolean; fontFamily?: string } = {},
): number => {
  const { held, fontSize, box } = slot
  if (!held || !fontSize) return 0
  const charWidth = charWidthFor(setting)
  const lineHeight = setting.lineHeight ?? LINE_H
  const perLine = Math.max(
    1,
    Math.floor((box.w * 100) / (fontSize * charWidth)),
  )
  // Every line is assumed as long as the longest, since only the longest was
  // measured. It is the generous reading, which is the right way to be wrong
  // about a box that would otherwise hide the end of a list.
  const rows = held.lines * Math.max(1, Math.ceil(held.longest / perLine))
  return (rows * fontSize * lineHeight) / SLIDE_H_CQI
}

/**
 * How much a box can hold, from its own width, height and type size.
 *
 * A hand-written template bounds its boxes through the text style each one
 * follows, and a layout's `constraints` name three boxes — `title`, `body`,
 * `caption`. An imported design used to have neither: its boxes carried
 * geometry and no text style, and they are named after whatever they turned
 * out to be, so a second column called `body-2` matched nothing and was
 * bounded by nothing. "Preview with every box at its limit" then had no limit
 * to draw, and on a design of any complexity it appeared to do nothing at all.
 *
 * Measured rather than named, because for an imported box the geometry IS the
 * bound: what it can hold is how wide it is, how tall, and how big its type.
 * That also makes the preview mean what it says — a box previewed at the
 * longest title of the three slides that happened to be sampled is not the
 * box at its limit.
 *
 * The same estimate `heightForText` runs, read the other way round: how many
 * characters fit across, times how many lines fit down. A bullets box counts
 * its lines as points, since that is what a point is here.
 */
export const capacityOf = (
  slot: CandidateSlot,
  /**
   * How the box is actually set, where that is known.
   *
   * The estimate used to assume one line height and one letter width for
   * every box on every slide, which made it wrong in both directions at
   * once — too generous for a title set in caps, too mean for one set with
   * tight display leading. Both are stated by the role a box follows, so
   * both are read from it rather than guessed.
   */
  setting: { lineHeight?: number; caps?: boolean; fontFamily?: string } = {},
): { maxChars?: number; maxItems?: number } => {
  const { box, fontSize, kind } = slot
  // A picture holds no text, and a table's shape is its rows, not a count.
  if (!fontSize || (kind !== 'text' && kind !== 'bullets')) return {}
  const charWidth = charWidthFor(setting)
  const lineHeight = setting.lineHeight ?? LINE_H
  const perLine = Math.max(
    1,
    Math.floor((box.w * 100) / (fontSize * charWidth)),
  )
  const lines = Math.max(
    1,
    Math.floor((box.h * SLIDE_H_CQI) / (fontSize * lineHeight)),
  )
  return kind === 'bullets'
    ? // For a list the character bound is per POINT, which is one line of it.
      { maxChars: perLine, maxItems: Math.min(lines, MAX_ITEMS) }
    : { maxChars: perLine * lines }
}
