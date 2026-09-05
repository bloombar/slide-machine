/**
 * Unit tests for the full-screen overlay (PLAY-5): renders its children,
 * sizes the stage by the min(100vw, 16:9-of-100vh) rule — the actual
 * largest 16:9 box that fits the viewport, nothing subtracted from it for
 * SlideNavZones' chevrons (those go inside the slide's edge instead — see
 * SlideNavZones' own `inset` prop and docs/DECISIONS.md) — paints the
 * letterbox in the passed background colour, and its close control works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import FullScreenStage, {
  STAGE_WIDTH_RULE,
  letterboxBars,
  isCornerPosition,
} from './FullScreenStage'

/** A DOMRect-shaped object for a given width/height — jsdom does no layout,
 * so every geometric quantity the component reads has to be stated. */
const rectOf = (width: number, height: number): DOMRect =>
  ({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect

/** The real getBoundingClientRect, restored after each test — Element.prototype
 * is mocked below and has to be put back so it does not leak into other
 * suites in the same run. */
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect
const realGetComputedStyle = window.getComputedStyle

/** The three boxes FullScreenStage now measures instead of inferring from
 * `window` — the overlay root, the stage, and the close button itself —
 * plus the root font-size it reads to convert the corner inset from rem.
 * Mutable so a single test can change them mid-flight and re-fire the
 * (stubbed) ResizeObserver to simulate a resize. */
let overlayBox = { width: 0, height: 0 }
let stageBox = { width: 0, height: 0 }
let buttonBox = { width: 0, height: 0 }
let rootFontSizePx = 16

/** The ResizeObserver instance FullScreenStage constructs, captured so a
 * test can fire its callback directly — the same way a real browser would
 * after the overlay it observes actually resizes. jsdom has no
 * ResizeObserver at all, so every test needs this stub, not just the ones
 * that use it. */
let lastObserverCallback: ResizeObserverCallback | null = null
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    lastObserverCallback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const fireResize = () => {
  act(() => {
    lastObserverCallback?.([], null as unknown as ResizeObserver)
  })
}

describe('FullScreenStage', () => {
  beforeEach(() => {
    overlayBox = { width: 0, height: 0 }
    stageBox = { width: 0, height: 0 }
    buttonBox = { width: 0, height: 0 }
    rootFontSizePx = 16
    lastObserverCallback = null
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    // Tells each element which box it stands for by the same markers the
    // real DOM carries: the overlay's own `.fixed.inset-0`, the stage's
    // `data-stage-width`, and the button by its tag — rather than a single
    // shared size, which would defeat the point of testing corner-vs-parked
    // as a comparison between two independently-measured boxes.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        if (this.hasAttribute('data-stage-width')) {
          return rectOf(stageBox.width, stageBox.height)
        }
        if (
          this.classList.contains('fixed') &&
          this.classList.contains('inset-0')
        ) {
          return rectOf(overlayBox.width, overlayBox.height)
        }
        if (this.tagName === 'BUTTON') {
          return rectOf(buttonBox.width, buttonBox.height)
        }
        return rectOf(0, 0)
      },
    )
    // Only the root element's font-size is faked — everything else (e.g.
    // jest-dom's toHaveStyle assertions, which read computed style too)
    // keeps jsdom's real behaviour.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(function (
      this: Window,
      el: Element,
      pseudo?: string | null,
    ) {
      if (el === document.documentElement) {
        return { fontSize: `${rootFontSizePx}px` } as CSSStyleDeclaration
      }
      return realGetComputedStyle.call(window, el, pseudo)
    })
  })

  afterEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = realGetBoundingClientRect
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

  // PLAY-5 round 6: the corner/parked step is keyed to the letterbox bars'
  // actual pixel width, measured off the overlay/stage rects themselves —
  // a real geometric quantity a plain function can be tested against
  // directly. isCornerPosition's threshold is now injected too, since the
  // component derives it from a measured button footprint rather than a
  // constant; the pure function is tested independent of that.
  describe('letterboxBars / isCornerPosition', () => {
    it('computes zero bars when the stage fills the overlay (nothing to spare on either axis)', () => {
      expect(letterboxBars(1280, 720, 1280, 720)).toEqual({
        sideBar: 0,
        topBar: 0,
      })
    })

    it('computes half the leftover space on each axis', () => {
      // A 2152-wide overlay with a 1920-wide stage: 232px left over, split
      // evenly either side.
      expect(letterboxBars(2152, 1080, 1920, 1080)).toEqual({
        sideBar: 116,
        topBar: 0,
      })
    })

    it('is a corner when either bar clears the threshold', () => {
      expect(isCornerPosition(60, 0, 44)).toBe(true)
      expect(isCornerPosition(0, 60, 44)).toBe(true)
    })

    it('stays parked when neither bar clears the threshold', () => {
      expect(isCornerPosition(35, 0, 44)).toBe(false)
    })

    it('sits right at the boundary either side of the threshold', () => {
      expect(isCornerPosition(43, 0, 44)).toBe(false)
      expect(isCornerPosition(44, 0, 44)).toBe(true)
    })
  })

  describe('corner/parked position, measured from the overlay/stage/button rects', () => {
    it('parks the control when neither measured bar clears the button-plus-inset footprint', () => {
      // 1350x720 overlay, a stage sized to the 16:9 rule at that height
      // (1280x720) — a 35px side bar, short of a ~44px footprint (32px
      // button + 12px inset at the default 16px root).
      overlayBox = { width: 1350, height: 720 }
      stageBox = { width: 1280, height: 720 }
      buttonBox = { width: 32, height: 32 }
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'parked')
    })

    it('moves the control to the true corner when a measured bar clears the footprint', () => {
      // 1400x720 overlay, same 1280x720 stage — a 60px side bar clears the
      // ~44px footprint.
      overlayBox = { width: 1400, height: 720 }
      stageBox = { width: 1280, height: 720 }
      buttonBox = { width: 32, height: 32 }
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'corner')
    })

    it('re-measures and moves to the corner when the overlay resizes', () => {
      overlayBox = { width: 1350, height: 720 }
      stageBox = { width: 1280, height: 720 }
      buttonBox = { width: 32, height: 32 }
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'parked')

      overlayBox = { width: 1400, height: 720 }
      fireResize()
      expect(wrapper).toHaveAttribute('data-close-position', 'corner')
    })

    it('reads the geometry already current at mount, not just on a later resize', () => {
      overlayBox = { width: 2152, height: 1080 }
      stageBox = { width: 1920, height: 1080 }
      buttonBox = { width: 32, height: 32 }
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'corner')
    })

    // The bug round 6 fixes: a hardcoded 16px-per-rem conversion says
    // "corner" here (12px inset + 32px button = 44px, and the 45px bar
    // clears it) at ANY root font-size. The real root font-size is 20px,
    // where the same 0.75rem inset is 15px, so the true footprint is 47px
    // — a 45px bar does not clear it, and the control must stay parked.
    it('uses the real root font-size, not a hardcoded 16px-per-rem assumption', () => {
      rootFontSizePx = 20
      overlayBox = { width: 1370, height: 720 }
      stageBox = { width: 1280, height: 720 } // 45px side bar
      buttonBox = { width: 32, height: 32 }
      render(
        <FullScreenStage background="#123456" onClose={vi.fn()}>
          <div>slide</div>
        </FullScreenStage>,
      )
      const close = screen.getByRole('button', { name: /full screen/i })
      const wrapper = close.closest('[data-close-position]') as HTMLElement
      expect(wrapper).toHaveAttribute('data-close-position', 'parked')
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
