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
import { useCallback, useLayoutEffect, useState } from 'react'
import { SLACK_EM, TIGHT_LEADING } from '@slide-machine/shared'

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

const slackFor = (el: HTMLElement): number => {
  const cs = getComputedStyle(el)
  const size = parseFloat(cs.fontSize)
  const leading = parseFloat(cs.lineHeight) / size
  if (!Number.isFinite(leading) || leading >= TIGHT_LEADING) return 1
  return Math.max(1, size * SLACK_EM)
}

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
): {
  /**
   * Put this on the box. A CALLBACK ref, not a ref object, and that is the
   * whole of a defect worth stating.
   *
   * A ref object is only ever filled in — nothing re-runs when it is. This
   * measurement lives in an effect keyed on `enabled`, so it ran once, on
   * mount, and captured whatever `ref.current` held at that instant. A box
   * whose slot has nothing to show yet renders NOTHING — no element, so no
   * ref, so the effect took its "no element" exit, set the scale to 1, and
   * attached no observers at all. When the content arrived and the box
   * finally existed, nothing was watching it and nothing re-ran: no observer
   * had ever been attached to fire.
   *
   * The box then drew at full size holding half again what it could show,
   * and reported a scale of 1 — indistinguishable from a box that genuinely
   * fits. It was not that the measurement got the wrong answer; it is that
   * the measurement never happened, and an absent measurement reads exactly
   * like a passing one.
   *
   * As a callback ref the element becomes state, the effect depends on it,
   * and a box that appears later is measured when it appears — as is one
   * React swaps for a different node, which the old code would have gone on
   * watching after it was detached.
   */
  ref: (node: HTMLElement | null) => void
  scale: number
  /**
   * True when the box is at the floor and STILL cannot show what it holds —
   * the only case where it needs to scroll.
   *
   * Reported rather than assumed because a scroll container is not free:
   * Chrome composites one per box, and a list view of a hundred slides made
   * hundreds of them, which was enough for the compositor to give up and
   * paint nothing at all. Safari drew it, headless Chromium drew it, and
   * Chrome and Brave showed blank slides.
   */
  overflowing: boolean
} => {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])
  const [scale, setScale] = useState(1)
  const [overflowing, setOverflowing] = useState(false)

  /*
   * This effect writes state, deliberately and before paint.
   *
   * Measuring laid-out geometry and writing the result back IS what a layout
   * effect is for — the size a box needs cannot be known during render, only
   * after the browser has laid it out, and the answer has to be applied
   * before the frame is shown or the reader sees the unshrunk text flash.
   * The rule warns about cascading renders, and the cascade is bounded here:
   * `measure` sets a scale, the scale changes only the type size, and the
   * observers that could re-enter are the ones that exist to.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!el || !enabled) {
      setScale(1)
      setOverflowing(false)
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
    // Measured once per pass, not per step. `slackFor` reads computed style,
    // and asking for it inside the search meant a style recalculation for
    // every one of the twenty-four steps, on every box, every time a box was
    // observed — hundreds of forced synchronous layouts per frame in a list
    // of a hundred slides. The type size changes as the search runs, so the
    // slack is taken from the size the design ASKS for, which is the size the
    // overhang it exists to tolerate is measured against.
    let slack = 1
    const fits = (): boolean => el.scrollHeight <= el.clientHeight + slack

    const measure = () => {
      // A box with no size yet — still being laid out, or hidden — cannot be
      // measured, and shrinking against a zero height would take every box to
      // the floor.
      if (!el.clientHeight) return
      // Start from full size: the content may have got shorter, and a box
      // that only ever shrank would stay small for the rest of the session.
      el.style.setProperty('--fit-scale', '1')
      slack = slackFor(el)
      if (fits()) {
        setScale(1)
        setOverflowing(false)
        return
      }
      for (let step = 1; step <= STEPS; step++) {
        const next = 1 - (step / STEPS) * (1 - MIN_SCALE)
        el.style.setProperty('--fit-scale', String(next))
        if (fits()) {
          setScale(next)
          setOverflowing(false)
          return
        }
      }
      // Past the floor the slide simply holds too much; it is left readable
      // rather than shrunk into a smear, and given a scrollbar so the rest
      // can still be reached.
      setScale(MIN_SCALE)
      setOverflowing(true)
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
  }, [enabled, el])
  /* eslint-enable react-hooks/set-state-in-effect */

  return { ref, scale, overflowing }
}
