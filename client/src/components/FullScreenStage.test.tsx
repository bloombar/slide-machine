/**
 * Unit tests for the full-screen overlay (PLAY-5): renders its children,
 * sizes the stage by the min(100vw, 16:9-of-100vh) rule — the actual
 * largest 16:9 box that fits the viewport, nothing subtracted from it for
 * SlideNavZones' chevrons (those go inside the slide's edge instead — see
 * SlideNavZones' own `inset` prop and docs/DECISIONS.md) — paints the
 * letterbox in the passed background colour, and its close control works.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import FullScreenStage, {
  STAGE_WIDTH_RULE,
  CORNER_THRESHOLD_PX,
  letterboxBars,
  isCornerPosition,
} from './FullScreenStage'

/** Sets the jsdom window to a given size and fires the resize event
 * FullScreenStage listens for, the same way a real browser would after a
 * user drags the window's edge. */
const resizeTo = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
  // The resize listener sets state outside any event React itself
  // dispatched, so `act` is what flushes that update before the next
  // assertion reads the DOM — without it the attribute below reflects
  // the PREVIOUS render.
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

describe('FullScreenStage', () => {
  // Every test that calls resizeTo mutates the shared jsdom `window` —
  // restore it to jsdom's own default afterwards so an earlier test's
  // viewport can't leak into a later one.
  afterEach(() => {
    cleanup()
    resizeTo(1024, 768)
  })

  it('renders its children', () => {
    render(
      <FullScreenStage background="#123456" onClose={vi.fn()}>
        <div data-testid="stage-child">slide</div>
      </FullScreenStage>,
    )
    expect(screen.getByTestId('stage-child')).toBeInTheDocument()
  })

  it('sizes the stage to the largest 16:9 box that fits the viewport', () => {
    render(
      <FullScreenStage background="#123456" onClose={vi.fn()}>
        <div data-testid="stage-child" />
      </FullScreenStage>,
    )
    // jsdom's style setter drops min()/calc() values it can't parse, so
    // reading them off element.style proves nothing (see FullScreenStage's
    // comment on STAGE_WIDTH_RULE) — assert the mirrored data attribute,
    // against the exported constant rather than a duplicated literal.
    const stage = screen.getByTestId('stage-child').parentElement!
    expect(stage).toHaveAttribute('data-stage-width', STAGE_WIDTH_RULE)
    // Nothing subtracted from either axis — a regression that reintroduced
    // a gutter (the whole point of round 2 of this slice) still fails here.
    expect(STAGE_WIDTH_RULE).toBe('min(100vw, calc(100vh * 16 / 9))')
  })

  it('paints the overlay in the passed background colour', () => {
    render(
      <FullScreenStage background="#123456" onClose={vi.fn()}>
        <div>slide</div>
      </FullScreenStage>,
    )
    const overlay = screen
      .getByText('slide')
      .closest('.fixed.inset-0') as HTMLElement
    expect(overlay).toHaveStyle({ backgroundColor: '#123456' })
  })

  it('closes on the close button, which has an accessible name', () => {
    const onClose = vi.fn()
    render(
      <FullScreenStage background="#123456" onClose={onClose}>
        <div>slide</div>
      </FullScreenStage>,
    )
    const close = screen.getByRole('button', { name: /full screen/i })
    expect(close).toBeInTheDocument()
    close.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('anchors the close control to the overlay, not the stage, so it never sits over the slide on a non-16:9 viewport', () => {
    render(
      <FullScreenStage background="#123456" onClose={vi.fn()}>
        <div data-testid="stage-child" />
      </FullScreenStage>,
    )
    const stage = screen.getByTestId('stage-child').parentElement!
    const close = screen.getByRole('button', { name: /full screen/i })
    // Not a descendant of the stage (data-stage-width) — it must be parked
    // in the letterbox surround, which only the overlay root's own corner
    // reaches on a wider/taller-than-16:9 viewport.
    expect(stage.contains(close)).toBe(false)
  })

  // PLAY-5 round 5: the corner/parked step is keyed to the letterbox bars'
  // actual pixel width, not aspect ratio — a real geometric quantity a
  // plain function can be tested against directly, unlike the CSS
  // media-query rule it replaced (jsdom neither parses `calc()` in
  // `element.style` nor evaluates media queries, so those old assertions
  // proved a formula equalled a copy of itself and nothing else).
  describe('letterboxBars / isCornerPosition', () => {
    it('computes zero bars at exactly 16:9 (nothing to spare on either axis)', () => {
      expect(letterboxBars(1280, 720)).toEqual({ sideBar: 0, topBar: 0 })
      expect(isCornerPosition(1280, 720)).toBe(false)
    })

    it('is a corner at 2152x1080 — a ratio (1.99) most thresholds would call "not wide", but a 116px side bar', () => {
      const { sideBar } = letterboxBars(2152, 1080)
      expect(sideBar).toBeCloseTo(116, 0)
      expect(isCornerPosition(2152, 1080)).toBe(true)
    })

    it('is a corner at 1400x720 too — a 60px side bar, still an ordinary window, still clears the 44px threshold', () => {
      const { sideBar } = letterboxBars(1400, 720)
      expect(sideBar).toBeCloseTo(60, 0)
      expect(isCornerPosition(1400, 720)).toBe(true)
    })

    it('stays parked at 1350x720 — a 35px side bar is short of the threshold', () => {
      const { sideBar } = letterboxBars(1350, 720)
      expect(sideBar).toBeCloseTo(35, 0)
      expect(isCornerPosition(1350, 720)).toBe(false)
    })

    it('sits right at the boundary either side of CORNER_THRESHOLD_PX', () => {
      // Solve vw for a side bar of exactly the threshold at a fixed height,
      // then nudge it a pixel either way.
      const vh = 720
      const boundaryVw = vh * (16 / 9) + 2 * CORNER_THRESHOLD_PX
      expect(isCornerPosition(boundaryVw - 1, vh)).toBe(false)
      expect(isCornerPosition(boundaryVw + 1, vh)).toBe(true)
    })
  })

  describe('resize updates the close control’s position', () => {
    it('parks the control (not the corner) at 1350x720, where the side bar (35px) is short of the threshold', () => {
      resizeTo(1350, 720)
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'parked')
    })

    it('moves the control to the true corner on resize to 1400x720, where the side bar (60px) clears the threshold', () => {
      resizeTo(1350, 720)
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'parked')
      resizeTo(1400, 720)
      expect(wrapper).toHaveAttribute('data-close-position', 'corner')
    })

    it('reads the viewport already current at mount, not just on a later resize', () => {
      resizeTo(2152, 1080)
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'corner')
    })
  })

  it('renders the close control as a discreet pill, not a high-contrast square', () => {
    render(
      <FullScreenStage background="#123456" onClose={vi.fn()}>
        <div>slide</div>
      </FullScreenStage>,
    )
    const close = screen.getByRole('button', { name: /full screen/i })
    // Round (a pill, matching the slide's own kebab menu) and a dark scrim
    // dark enough to hold WCAG 1.4.11's 3:1 contrast for the white glyph
    // over a light letterbox (bg-black/30 measured ~2.3:1 there; /50 is the
    // fix — see the button's own className comment for the measured ratio).
    expect(close).toHaveClass('rounded-full')
    expect(close).toHaveClass('bg-black/50')
  })
})
