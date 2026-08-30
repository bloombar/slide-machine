/**
 * Unit tests for shrinking a box's type until what it holds fits (TMPL-8).
 *
 * A slide the app wrote is written to the box's limits, so nothing here
 * changes for it. One imported from elsewhere arrives holding whatever its
 * author put on it, and the end of it was simply clipped — the words were
 * there, below the fold of a box that could not show them. Losing the end of
 * a sentence is worse than reading it a point smaller.
 *
 * jsdom lays nothing out, so `scrollHeight` and `clientHeight` are stubbed:
 * what is tested is the decision the hook makes from those numbers, not the
 * browser's measuring, which is the browser's job.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { NATURAL_LINE_BOX } from '@slide-machine/shared'
import { useFitText } from './useFitText'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * Stands a box up whose content is `contentPx` tall in a box of `boxPx`.
 *
 * The overflow shrinks with the scale the hook sets, exactly as real text
 * does: half the type, roughly half the height.
 */
const stubBox = (contentPx: number, boxPx: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return boxPx
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 100,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => 100,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const scale = Number(this.style.getPropertyValue('--fit-scale') || 1)
      return Math.round(contentPx * scale)
    },
  })
}

function Box({
  enabled = true,
  children,
}: {
  enabled?: boolean
  children?: React.ReactNode
}) {
  const { ref, scale } = useFitText(enabled)
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      data-testid="box"
      data-scale={scale}
      style={{ '--fit-scale': scale } as React.CSSProperties}
    >
      {children ?? 'words'}
    </div>
  )
}

/**
 * The same box, told what type it is set in.
 *
 * `slackFor` reads the box's own font size and line height off computed
 * style, so the allowance it grants cannot be exercised without them. jsdom
 * lays nothing out but does report inline declarations, which is all the hook
 * asks for.
 */
function TypedBox({
  fontSizePx,
  leading,
}: {
  fontSizePx: number
  leading: number
}) {
  const { ref, scale } = useFitText(true)
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      data-testid="box"
      data-scale={scale}
      style={
        {
          '--fit-scale': scale,
          fontSize: `${fontSizePx}px`,
          lineHeight: `${fontSizePx * leading}px`,
        } as React.CSSProperties
      }
    >
      words
    </div>
  )
}

const scaleOf = () =>
  Number(screen.getByTestId('box').getAttribute('data-scale'))

describe('fitting a box’s type to what it holds', () => {
  it('leaves a box that already fits at full size', () => {
    stubBox(80, 100)
    render(<Box />)
    expect(scaleOf()).toBe(1)
  })

  it('shrinks a box whose content runs past the bottom', () => {
    stubBox(140, 100)
    render(<Box />)
    expect(scaleOf()).toBeLessThan(1)
  })

  it('shrinks only as far as it has to', () => {
    // A box a little over should come back a little smaller, not at the
    // floor: the slide should look like itself.
    stubBox(110, 100)
    render(<Box />)
    expect(scaleOf()).toBeGreaterThan(0.85)
    expect(scaleOf()).toBeLessThan(1)
  })

  it('has a floor, so a slide holding far too much stays legible', () => {
    // Past it the honest answer is that the slide holds too much. The floor
    // is low — a hand-made lecture slide carries several times what a
    // generated one does, and a timid floor left those shrunk AND clipped,
    // which is the worst of both.
    stubBox(10_000, 100)
    render(<Box />)
    expect(scaleOf()).toBeGreaterThanOrEqual(0.4)
  })

  it('lands close to what a box needs, not at the floor', () => {
    // A box a quarter over should come back about a quarter smaller.
    stubBox(125, 100)
    render(<Box />)
    expect(scaleOf()).toBeGreaterThan(0.75)
    expect(scaleOf()).toBeLessThan(0.9)
  })

  it('leaves a box that fits alone, whatever a neighbour is doing', () => {
    // Each box fits itself, as it does in the app the slide came from. One
    // scale for the whole slide sounds right and is not: a single tight box
    // then drags every other box down with it, and a slide with room to
    // spare comes out half empty.
    stubBox(80, 100)
    render(
      <Box>
        <div data-node-id="crowded">a lot of words</div>
      </Box>,
    )
    expect(scaleOf()).toBe(1)
  })

  it('ignores a box being a few pixels wide of its own edge', () => {
    // A list marker hanging in the margin is not something a smaller type
    // size can fix — at three-point type it was still four pixels over — and
    // counting it took the box to the floor with its height half empty.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 100,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 328,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 332,
    })
    render(<Box />)
    expect(scaleOf()).toBe(1)
  })

  it('leaves a box alone when fitting is off', () => {
    // A listing scrolls on purpose: its line breaks are content, and
    // re-wrapping it smaller would be a different program.
    stubBox(1000, 100)
    render(<Box enabled={false} />)
    expect(scaleOf()).toBe(1)
  })

  it('holds its size while the box is being typed into', () => {
    // A field's height is reserved in pixels from the display it replaced, so
    // it does not answer to the type size the search steps: whatever editing
    // adds is height no scale can clear, and the search ran every step and
    // landed on the floor. The words went to two fifths under the cursor.
    stubBox(140, 100)
    render(
      <Box>
        <input aria-label="Slide title" defaultValue="words" />
      </Box>,
    )
    expect(scaleOf()).toBe(1)
  })

  it('measures again once the field goes away', async () => {
    // The control. Without it the case above would pass on a hook that had
    // stopped measuring altogether, and a box left small for the rest of the
    // session is the fault this replaced.
    stubBox(140, 100)
    const { rerender } = render(
      <Box>
        <input aria-label="Slide title" defaultValue="words" />
      </Box>,
    )
    expect(scaleOf()).toBe(1)
    rerender(<Box>words</Box>)
    // The re-measure rides on the mutation observer, which fires in a
    // microtask rather than in the render that emptied the box.
    await waitFor(() => expect(scaleOf()).toBeLessThan(1))
  })

  it('does not measure a box that has no size yet', () => {
    // Still being laid out, or hidden. Shrinking against a zero height would
    // take every box straight to the floor.
    stubBox(140, 0)
    render(<Box />)
    expect(scaleOf()).toBe(1)
  })
})

/**
 * The coupling between the font's natural line box and the tight-leading
 * threshold, which nothing else in the codebase records.
 *
 * `NATURAL_LINE_BOX` is 1.196 and `TIGHT_LEADING` is 1.2. They sit four
 * thousandths apart, and every derived design's leading is some multiple of
 * the first: a deck's line spacing is a percentage, so 100% — the commonest
 * setting there is — lands exactly on `NATURAL_LINE_BOX`, four thousandths
 * under the threshold and therefore on the generous side of it.
 *
 * That margin is narrower than the measurement error anyone would accept
 * while refining a measured constant. `NATURAL_LINE_BOX` IS a measurement,
 * carried to three decimals, and someone tightening it to 1.20 would be doing
 * careful work. Every 100%-spaced box in every deck-derived design would
 * silently move from a quarter-em allowance to a single pixel, and boxes that
 * fit today would start shrinking — a whole design a little smaller than the
 * deck it came from, with no failing test and nothing to say why.
 *
 * ## Why the ordering rather than the numbers
 *
 * A case asserting `NATURAL_LINE_BOX === 1.196` pins a value, and the next
 * person to measure it more precisely would simply update the number and
 * learn nothing. What has to hold is the RELATION, so it is exercised through
 * the hook's actual decision rather than asserted arithmetically: a box led
 * at the natural line box, overrunning by more than a pixel and less than a
 * quarter of an em, must come back at full size.
 *
 * ## Which direction it holds in, because the fix is not obvious
 *
 * The allowance exists because a face whose natural line box is tighter than
 * `TIGHT_LEADING` hangs its descenders outside that box, so `scrollHeight`
 * exceeds `clientHeight` at every type size — the argument `SLACK_EM`'s own
 * docstring makes. That is a fact about letterforms, not a tuning choice.
 *
 * So if a face is ever measured with a natural line box at or above
 * `TIGHT_LEADING`, widening `TIGHT_LEADING` to keep this green is the wrong
 * response: the premise it rests on has stopped holding, and the overhang it
 * tolerates is no longer there to tolerate.
 */
describe('the natural line box against the tight-leading threshold', () => {
  // More than the pixel of rounding, less than a quarter of an em at 100px.
  // A box that overruns by this much fits under the generous allowance and
  // does not under the strict one, which is what makes it discriminate.
  const OVERRUN_PX = 10
  const FONT_PX = 100

  it('leaves a box led at the natural line box at full size', () => {
    stubBox(100 + OVERRUN_PX, 100)
    render(<TypedBox fontSizePx={FONT_PX} leading={NATURAL_LINE_BOX} />)
    expect(
      scaleOf(),
      `a box led at NATURAL_LINE_BOX (${NATURAL_LINE_BOX}) overran by ` +
        `${OVERRUN_PX}px and was shrunk. That means it is no longer under ` +
        `TIGHT_LEADING, so it lost the quarter-em overhang allowance and now ` +
        `gets a single pixel. The two constants sit four thousandths apart ` +
        `and a derived design's 100% line spacing lands exactly on the ` +
        `first, so this moves EVERY ordinary text box in EVERY deck-derived ` +
        `design onto the strict path: they will shrink below the size the ` +
        `deck sets them at, everywhere, with nothing else failing. If a face ` +
        `has genuinely been measured at or above TIGHT_LEADING, do not widen ` +
        `TIGHT_LEADING to get past this — the descender overhang it exists ` +
        `to tolerate is no longer there, and the allowance should go instead.`,
    ).toBe(1)
  })

  it('shrinks the same box once its leading is no longer tight', () => {
    // The control. Without it the case above would pass on a hook that had
    // stopped shrinking anything at all, and a permanent green is worth less
    // than no check. Same box, same overrun, leading moved to the far side
    // of the threshold.
    stubBox(100 + OVERRUN_PX, 100)
    render(<TypedBox fontSizePx={FONT_PX} leading={1.5} />)
    expect(
      scaleOf(),
      'a box led loosely enough to have no descender overhang should get ' +
        'the pixel of rounding and nothing more, so a ten-pixel overrun is ' +
        'a real one',
    ).toBeLessThan(1)
  })
})
