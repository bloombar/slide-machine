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
import { render, screen, cleanup } from '@testing-library/react'
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

  it('does not measure a box that has no size yet', () => {
    // Still being laid out, or hidden. Shrinking against a zero height would
    // take every box straight to the floor.
    stubBox(140, 0)
    render(<Box />)
    expect(scaleOf()).toBe(1)
  })
})
