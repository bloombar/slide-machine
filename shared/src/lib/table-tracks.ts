/**
 * How wide a table's columns are, and how tall its rows (EDIT-7).
 *
 * A table used to split its box into equal columns everywhere it was drawn.
 * That is a reasonable default and a poor answer for real data: a table of a
 * year and a sentence gives half the width to the year, and the sentence wraps
 * to four lines beside it. So a table can now carry its own track sizes.
 *
 * ## Fractions, not points
 *
 * Each size is a fraction of the table's own width or height, so a table means
 * the same thing on screen, in a PDF, and in a PowerPoint — three surfaces at
 * three sizes — and keeps its proportions when the box it sits in changes.
 *
 * ## Normalised on the way out, not on the way in
 *
 * The stored sizes are whatever the editor last wrote, which may be one short
 * (a column was added), one long (one was removed), or not quite summing to
 * one (rounding, a dozen small drags). Rather than migrating stored decks,
 * every surface reads them through here and gets back a list that is the right
 * length and sums to one — so a table with no sizes, a table with stale sizes,
 * and a table someone hand-edited all draw without special cases.
 */

/**
 * `count` fractions summing to 1: the sizes given, where they are usable, and
 * an equal share everywhere else.
 *
 * A missing or unusable size means "no preference", and gets what is left over
 * divided evenly — so adding a column to a sized table leaves the other
 * columns alone rather than resetting them all.
 */
export const tableTracks = (
  sizes: number[] | undefined,
  count: number,
): number[] => {
  if (count <= 0) return []
  const equal = 1 / count
  // A size has to be a positive number and smaller than the whole table; a
  // NaN, a zero or a negative from somewhere would collapse a column entirely.
  const usable = (n: number | undefined): boolean =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1
  const given = Array.from({ length: count }, (_, i) => sizes?.[i])
  const known = given.filter(usable) as number[]
  const claimed = known.reduce((sum, n) => sum + n, 0)
  // What the unsized tracks share. Never negative: sizes that already claim
  // the whole table leave nothing, and the scaling below sorts it out.
  const spare = Math.max(0, 1 - claimed)
  const unsized = count - known.length
  const each = unsized ? spare / unsized : 0
  const out = given.map(n => (usable(n) ? (n as number) : each))
  // Scale to exactly one, which also rescues the case above.
  const total = out.reduce((sum, n) => sum + n, 0)
  if (total <= 0) return Array.from({ length: count }, () => equal)
  return out.map(n => n / total)
}

/** How many columns a table has: the widest of its rows and its header. */
export const tableColumnCount = (rows: string[][], header?: string[]): number =>
  Math.max(header?.length ?? 0, ...rows.map(r => r.length), 1)

/**
 * The stored sizes with one track resized, ready to store again.
 *
 * A drag moves one boundary: the track grows and its neighbour gives up
 * exactly what it gained, so the rest of the table does not shift and the
 * total stays one. Both are kept above `MIN_TRACK` — a column dragged to
 * nothing is unrecoverable, since there would be no edge left to grab.
 */
export const resizeTrack = (
  sizes: number[] | undefined,
  count: number,
  /** The track being dragged; its right (or lower) edge is what moved. */
  index: number,
  /** How much of the table's width or height it gained, as a fraction. */
  by: number,
): number[] => {
  const current = tableTracks(sizes, count)
  const here = current[index]
  const next = current[index + 1]
  // The last track has no neighbour to take from, so its edge is the table's
  // own and cannot be dragged. Nor can one that is not there.
  if (here === undefined || next === undefined) return current
  const room = here + next
  const grown = Math.min(Math.max(here + by, MIN_TRACK), room - MIN_TRACK)
  const out = [...current]
  out[index] = grown
  out[index + 1] = room - grown
  return out
}

/** The smallest a track may be dragged, as a fraction of the table. Small
 * enough to be useful, large enough to stay grabbable. */
export const MIN_TRACK = 0.04
