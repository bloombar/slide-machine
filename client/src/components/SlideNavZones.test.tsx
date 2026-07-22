/**
 * Unit tests for pointer navigation zones: which chevron the cursor
 * position reveals, bounds, and click behavior.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SlideNavZones from './SlideNavZones'

const renderZones = (
  hasPrev: boolean,
  hasNext: boolean,
  onPrev = vi.fn(),
  onNext = vi.fn(),
) => {
  const { container } = render(
    <SlideNavZones
      hasPrev={hasPrev}
      hasNext={hasNext}
      onPrev={onPrev}
      onNext={onNext}
    >
      <div data-testid="slide">
        SLIDE
        <button>inner control</button>
      </div>
    </SlideNavZones>,
  )
  // jsdom does no layout, so the root reports a zero-size rect; pin a known
  // box so midpoint maths (clientX vs rect.left + width/2) is exercisable.
  const root = container.firstChild as HTMLElement
  root.getBoundingClientRect = () =>
    ({
      left: 0,
      width: 100,
      right: 100,
      top: 0,
      bottom: 100,
      height: 100,
    }) as DOMRect
  return { root, onPrev, onNext }
}

describe('SlideNavZones', () => {
  it('navigates on zone clicks', () => {
    const { onPrev, onNext } = renderZones(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('reveals the chevron for the side of the midpoint the cursor is on', () => {
    const { root } = renderZones(true, true)
    const prev = screen.getByRole('button', { name: 'Previous slide' })
    const next = screen.getByRole('button', { name: 'Next slide' })

    // Both hidden until the cursor is over the slide
    expect(prev.className).toContain('opacity-0')
    expect(next.className).toContain('opacity-0')

    // Left of the 50px midpoint reveals previous, hides next
    fireEvent.mouseMove(root, { clientX: 20 })
    expect(prev.className).toContain('opacity-100')
    expect(next.className).toContain('opacity-0')

    // Right of the midpoint reveals next, hides previous
    fireEvent.mouseMove(root, { clientX: 80 })
    expect(next.className).toContain('opacity-100')
    expect(prev.className).toContain('opacity-0')

    // Leaving the slide hides both again
    fireEvent.mouseLeave(root)
    expect(prev.className).toContain('opacity-0')
    expect(next.className).toContain('opacity-0')
  })

  it('omits the previous zone on the first slide', () => {
    renderZones(false, true)
    expect(
      screen.queryByRole('button', { name: 'Previous slide' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Next slide' }),
    ).toBeInTheDocument()
  })

  it('omits the next zone on the last slide', () => {
    renderZones(true, false)
    expect(
      screen.getByRole('button', { name: 'Previous slide' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Next slide' }),
    ).not.toBeInTheDocument()
  })
})

/** Drives a pointerdown→pointerup drag across an element. */
const swipe = (el: Element, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 })
}

describe('SlideNavZones swipe', () => {
  it('advances on a leftward swipe past the threshold', () => {
    const { onPrev, onNext } = renderZones(true, true)
    swipe(screen.getByTestId('slide'), [200, 100], [120, 105])
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('goes back on a rightward swipe past the threshold', () => {
    const { onPrev, onNext } = renderZones(true, true)
    swipe(screen.getByTestId('slide'), [120, 100], [200, 95])
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('ignores travel below the threshold (a tap)', () => {
    const { onPrev, onNext } = renderZones(true, true)
    swipe(screen.getByTestId('slide'), [150, 100], [160, 100])
    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('ignores a vertical-dominant drag (a scroll)', () => {
    const { onPrev, onNext } = renderZones(true, true)
    swipe(screen.getByTestId('slide'), [150, 100], [110, 400])
    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('does not swipe past the last slide', () => {
    const { onNext } = renderZones(true, false)
    swipe(screen.getByTestId('slide'), [200, 100], [120, 100])
    expect(onNext).not.toHaveBeenCalled()
  })

  it('leaves gestures that start on a control alone', () => {
    const { onPrev, onNext } = renderZones(true, true)
    swipe(screen.getByText('inner control'), [200, 100], [120, 100])
    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('ignores non-primary mouse buttons', () => {
    const { onNext } = renderZones(true, true)
    const slide = screen.getByTestId('slide')
    fireEvent.pointerDown(slide, {
      clientX: 200,
      clientY: 100,
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
    })
    fireEvent.pointerUp(slide, {
      clientX: 120,
      clientY: 100,
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
    })
    expect(onNext).not.toHaveBeenCalled()
  })

  it('clears a tracked gesture on pointer cancel', () => {
    const { onNext } = renderZones(true, true)
    const slide = screen.getByTestId('slide')
    fireEvent.pointerDown(slide, { clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerCancel(slide, { pointerId: 1 })
    fireEvent.pointerUp(slide, { clientX: 120, clientY: 100, pointerId: 1 })
    expect(onNext).not.toHaveBeenCalled()
  })
})
