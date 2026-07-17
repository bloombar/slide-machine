/**
 * Unit tests for the shared slide-navigation hook: index movement,
 * bounds, and list-mode scroll-into-view.
 */
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSlideNavigation } from './useSlideNavigation'
import type { ViewMode } from '../components/ViewModeToggle'

/** Fakes an element's on-screen box; jsdom returns all-zeros otherwise. */
const placeRect = (el: HTMLElement, top: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

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

function VisibleHarness({ count = 3 }: { count?: number }) {
  const nav = useSlideNavigation(count, 'list')
  const [result, setResult] = useState('')
  return (
    <div>
      <span data-testid="visible">{result}</span>
      <button onClick={() => setResult(String(nav.visibleIndex()))}>
        check
      </button>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} ref={nav.registerItem(i)} data-testid={`item-${i}`} />
      ))}
    </div>
  )
}

describe('useSlideNavigation.visibleIndex', () => {
  it('returns the item nearest the viewport center', () => {
    window.innerHeight = 600
    render(<VisibleHarness />)
    placeRect(screen.getByTestId('item-0'), -400, 300) // above the fold
    placeRect(screen.getByTestId('item-1'), 200, 300) // center 350, nearest
    placeRect(screen.getByTestId('item-2'), 700, 300) // below the fold
    fireEvent.click(screen.getByText('check'))
    expect(screen.getByTestId('visible')).toHaveTextContent('1')
  })

  it('picks the closer of two on-screen items', () => {
    window.innerHeight = 600
    render(<VisibleHarness />)
    placeRect(screen.getByTestId('item-0'), 260, 100) // center 310, dist 10
    placeRect(screen.getByTestId('item-1'), 400, 100) // center 450, dist 150
    placeRect(screen.getByTestId('item-2'), -200, 100) // off-screen
    fireEvent.click(screen.getByText('check'))
    expect(screen.getByTestId('visible')).toHaveTextContent('0')
  })

  it('returns null when nothing is on screen (scrolled away)', () => {
    window.innerHeight = 600
    render(<VisibleHarness />)
    placeRect(screen.getByTestId('item-0'), -500, 100)
    placeRect(screen.getByTestId('item-1'), -300, 100)
    placeRect(screen.getByTestId('item-2'), 900, 100)
    fireEvent.click(screen.getByText('check'))
    expect(screen.getByTestId('visible')).toHaveTextContent('null')
  })
})
