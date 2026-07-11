/**
 * Unit tests for the shared slide-navigation hook: index movement,
 * bounds, and list-mode scroll-into-view.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSlideNavigation } from './useSlideNavigation'
import type { ViewMode } from '../components/ViewModeToggle'

function Harness({ mode, count = 3 }: { mode: ViewMode; count?: number }) {
  const nav = useSlideNavigation(count, mode)
  return (
    <div>
      <span data-testid="current">{nav.current}</span>
      <button onClick={nav.goPrev}>prev</button>
      <button onClick={nav.goNext}>next</button>
      {mode === 'list' &&
        Array.from({ length: count }, (_, i) => (
          <div key={i} ref={nav.registerItem(i)} data-testid={`item-${i}`} />
        ))}
    </div>
  )
}

describe('useSlideNavigation', () => {
  it('moves with arrow keys and clamps at bounds', () => {
    render(<Harness mode="carousel" />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('current')).toHaveTextContent('0')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('current')).toHaveTextContent('2')
  })

  it('shares the same handlers with chevron-style buttons', () => {
    render(<Harness mode="carousel" />)
    fireEvent.click(screen.getByText('next'))
    expect(screen.getByTestId('current')).toHaveTextContent('1')
    fireEvent.click(screen.getByText('prev'))
    expect(screen.getByTestId('current')).toHaveTextContent('0')
  })

  it('scrolls the current item into view in list mode', () => {
    render(<Harness mode="list" />)
    const scrolled = vi.fn()
    screen.getByTestId('item-1').scrollIntoView = scrolled

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(scrolled).toHaveBeenCalled()
  })

  it('does not scroll in carousel mode', () => {
    render(<Harness mode="carousel" count={2} />)
    // No items registered in carousel mode; navigation must not throw
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('current')).toHaveTextContent('1')
  })
})
