/**
 * Unit tests for the full-screen overlay (PLAY-5): renders its children,
 * sizes the stage by the min(100vw, 16:9-of-100vh) rule — the actual
 * largest 16:9 box that fits the viewport, nothing subtracted from it for
 * SlideNavZones' chevrons (those go inside the slide's edge instead — see
 * SlideNavZones' own `inset` prop and docs/DECISIONS.md) — paints the
 * letterbox in the passed background colour, and its close control works.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FullScreenStage, {
  STAGE_WIDTH_RULE,
  CLOSE_INSET_RULE,
} from './FullScreenStage'

describe('FullScreenStage', () => {
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
    // The inset rule collapses as the side letterbox grows, unlike a fixed
    // offset — see FullScreenStage's own comment on CLOSE_INSET_RULE. jsdom
    // drops calc()/max() from element.style, so read it off the mirrored
    // data attribute (same reason as STAGE_WIDTH_RULE above).
    const wrapper = close.closest('[data-close-inset]') as HTMLElement
    expect(wrapper).toHaveAttribute('data-close-inset', CLOSE_INSET_RULE)
  })
})
