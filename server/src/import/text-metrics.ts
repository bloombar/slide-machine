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

/** Roughly a character's width, as a fraction of the type size. */
const CHAR_W = 0.5
/** A line's full height, as a fraction of the type size. */
const LINE_H = 1.5
/** A 16:9 slide is this many `cqi` tall — `cqi` being a percent of its WIDTH. */
const SLIDE_H_CQI = 56.25

/** The most `maxItems` the template schema will take. */
const MAX_ITEMS = 50

/**
 * The height a box's own content needs, as a fraction of the slide's height.
 * Zero when nothing is known about what it holds.
 *
 * An estimate — there is no browser here — and deliberately a generous one.
 * Being a little taller than needed costs nothing on a box with space beneath
 * it; being too short costs the reader the end of every list.
 */
export const heightForText = (slot: CandidateSlot): number => {
  const { held, fontSize, box } = slot
  if (!held || !fontSize) return 0
  const perLine = Math.max(1, Math.floor((box.w * 100) / (fontSize * CHAR_W)))
  // Every line is assumed as long as the longest, since only the longest was
  // measured. It is the generous reading, which is the right way to be wrong
  // about a box that would otherwise hide the end of a list.
  const rows = held.lines * Math.max(1, Math.ceil(held.longest / perLine))
  return (rows * fontSize * LINE_H) / SLIDE_H_CQI
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
): { maxChars?: number; maxItems?: number } => {
  const { box, fontSize, kind } = slot
  // A picture holds no text, and a table's shape is its rows, not a count.
  if (!fontSize || (kind !== 'text' && kind !== 'bullets')) return {}
  const perLine = Math.max(1, Math.floor((box.w * 100) / (fontSize * CHAR_W)))
  const lines = Math.max(
    1,
    Math.floor((box.h * SLIDE_H_CQI) / (fontSize * LINE_H)),
  )
  return kind === 'bullets'
    ? // For a list the character bound is per POINT, which is one line of it.
      { maxChars: perLine, maxItems: Math.min(lines, MAX_ITEMS) }
    : { maxChars: perLine * lines }
}
