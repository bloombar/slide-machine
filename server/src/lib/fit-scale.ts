/**
 * How much to shrink a box's type so what it holds fits inside it (EXP-1).
 *
 * The screen does this by measuring: render, compare what the box scrolls
 * against what it shows, step down until they agree (`useFitText`). An
 * exporter has no browser, but it does lay the text out itself — it wraps to
 * the box's width and knows how tall the result came out — so it can ask the
 * same question of its own measurement.
 *
 * Without it the exporters drew every line from the top of the box whatever
 * its height: a slide holding more than its design allows ran off the bottom,
 * over whatever sat beneath it, and off the page. A file that did that was a
 * different lecture from the one its author saw.
 *
 * Shared by the PDF and the PowerPoint so the two cannot drift, and matching
 * the screen's floor so a slide shrinks to the same place in all three.
 */

/** How small type may get, as a fraction of the size the design asks for.
 * The screen's floor (`client/.../useFitText`). */
export const MIN_FIT_SCALE = 0.4

/** Steps between full size and the floor. Fine enough that a box needing a
 * little shrinks a little rather than dropping to the floor. */
export const FIT_STEPS = 24

/**
 * The largest scale at which the content fits, or the floor.
 *
 * Stepped rather than solved, because re-wrapping at a smaller size does not
 * shrink the height proportionally — fewer lines, and the last of them a
 * different length. `heightAt` is asked to lay the text out again at each
 * candidate, which is the only way to know.
 */
export const fitScale = (
  heightAt: (scale: number) => number,
  boxHeight: number,
): number => {
  // A box with no height to fill cannot be reasoned about; leave the type as
  // the design asked for it rather than shrinking against nothing.
  if (boxHeight <= 0) return 1
  if (heightAt(1) <= boxHeight) return 1
  for (let step = 1; step <= FIT_STEPS; step++) {
    const scale = 1 - (step / FIT_STEPS) * (1 - MIN_FIT_SCALE)
    if (heightAt(scale) <= boxHeight) return scale
  }
  // Past the floor the slide simply holds too much. Left legible rather than
  // shrunk into a smear, which is the screen's answer too.
  return MIN_FIT_SCALE
}

/** Roughly a character's width, as a fraction of the type size. */
const CHAR_W = 0.5
/** A line's full height, as a fraction of the type size. */
const LINE_H = 1.35

/**
 * About how tall some lines of text come out in a box of a given width.
 *
 * For an exporter that hands text to someone else to lay out — PowerPoint,
 * say — and so cannot measure it. An estimate, and a generous one: being a
 * little cautious costs a slide a slightly smaller type size, while being
 * optimistic costs it the last line.
 *
 * Everything is in one unit, whichever the caller uses, since only the ratio
 * of height to box matters.
 */
export const estimatedHeight = (
  lines: string[],
  fontSize: number,
  boxWidth: number,
): number => {
  if (!fontSize || !boxWidth) return 0
  const perLine = Math.max(1, Math.floor(boxWidth / (fontSize * CHAR_W)))
  const rows = lines.reduce(
    (n, line) => n + Math.max(1, Math.ceil(line.length / perLine)),
    0,
  )
  return rows * fontSize * LINE_H
}
