/**
 * Shrinking a box's type until what it holds fits inside it.
 *
 * A slide box draws at the size its design asks for and clips whatever does
 * not fit (`overflow-hidden`). That is right for a deck the app wrote — the
 * limits are enforced when the text is generated — and wrong for one imported
 * from somewhere else, where a slide arrives holding as much as its author
 * put on it. The content was all there; the bottom of it simply could not be
 * seen.
 *
 * Losing the end of a sentence is worse than reading it a point smaller, so
 * the box keeps its geometry and the type gives way.
 *
 * ## Measured, not estimated
 *
 * How much text fits depends on the font, the wrapping and the box, which is
 * a question only the browser can answer. So this asks it: render, compare
 * how tall the box scrolls against how tall it shows, and step the size down
 * until they agree. The alternative — guessing from character counts — is the same
 * arithmetic the exporters do, and it is wrong often enough to be visible.
 *
 * ## One box at a time
 *
 * Each box fits itself, as it does in the app the slide came from. Scaling
 * the whole slide by one factor keeps the design's proportions, which sounds
 * right and is not: one tight box then drags every other box down with it,
 * and a slide with room to spare comes out half empty. A box that fits is
 * left alone.
 *
 * ## Bounded
 *
 * Never below `MIN_SCALE`. A box asked to hold five hundred words would
 * otherwise shrink them to a grey smear, which is unreadable in a different
 * way: past a point the honest answer is that the slide holds too much, and
 * the author is better served seeing that than being handed six-point type.
 */
import { useLayoutEffect, useRef, useState } from 'react'

/**
 * How small the type may get, as a fraction of the size the design asks for.
 *
 * Two thirds was the first answer, reasoning about what reads from the back
 * of a room — and it was too timid for the decks this exists for. A hand-made
 * lecture slide can carry three times what a generated one does, and stopping
 * at two thirds left those still clipped: shrunk, and still hiding the end of
 * a sentence, which is the worst of both.
 *
 * Two fifths fits the dense ones. It is small, but it is the size the author
 * already chose to write at — the slide was always this full, and the
 * alternative is not showing it.
 */
const MIN_SCALE = 0.4

/** Steps between full size and the floor. Fine enough that a box needing a
 * little lands a little smaller rather than dropping to the floor, few enough
 * that fitting settles in a frame or two. */
const STEPS = 24

/** A pixel of slack, so a box that fits exactly is not shrunk by a rounding
 * difference between `scrollHeight` and `clientHeight`. */
const SLACK = 1

/**
 * A ref to put on the box, and the scale its type should draw at.
 *
 * The caller applies the scale, through the `--fit-scale` custom property the
 * type sizes are written against. The measurement sets that property directly
 * while it searches — transiently, one frame — and the value React renders is
 * the one that lasts.
 */
export const useFitText = (
  /** Off for boxes that scroll on purpose, like a program listing. */
  enabled = true,
): { ref: React.RefObject<HTMLElement | null>; scale: number } => {
  const ref = useRef<HTMLElement | null>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) {
      setScale(1)
      return
    }

    /**
     * Whether this box, at this scale, shows everything it holds.
     *
     * Height only. Text wraps, so width is not what hides it — and a box that
     * is a few pixels wide of its own edge is wide for reasons type cannot
     * fix: a list marker hanging in the margin, a rounded padding. Counting
     * width took those boxes to the floor with their height half empty,
     * still four pixels over at three-point type.
     */
    const fits = (): boolean => el.scrollHeight <= el.clientHeight + SLACK

    const measure = () => {
      // A box with no size yet — still being laid out, or hidden — cannot be
      // measured, and shrinking against a zero height would take every box to
      // the floor.
      if (!el.clientHeight) return
      // Start from full size: the content may have got shorter, and a box
      // that only ever shrank would stay small for the rest of the session.
      el.style.setProperty('--fit-scale', '1')
      if (fits()) {
        setScale(1)
        return
      }
      for (let step = 1; step <= STEPS; step++) {
        const next = 1 - (step / STEPS) * (1 - MIN_SCALE)
        el.style.setProperty('--fit-scale', String(next))
        if (fits()) {
          setScale(next)
          return
        }
      }
      // Past the floor the slide simply holds too much; it is left readable
      // rather than shrunk into a smear.
      setScale(MIN_SCALE)
    }

    measure()

    // The same text fits differently in a box that changed size — a resized
    // window, a switched layout, the editor's preview against the viewer.
    const resize = new ResizeObserver(measure)
    resize.observe(el)

    // And a box the same size fits differently when its text changes, which
    // no resize reports: the box is fixed and only what is inside it moved.
    // Attributes are deliberately not watched — the measurement writes one,
    // and watching them would have it wake itself in a loop.
    const edits = new MutationObserver(measure)
    edits.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    return () => {
      resize.disconnect()
      edits.disconnect()
    }
  }, [enabled])

  return { ref, scale }
}
