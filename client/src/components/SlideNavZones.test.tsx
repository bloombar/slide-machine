/**
 * Unit tests for hover navigation zones: bounds and click behavior.
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
  render(
    <SlideNavZones
      hasPrev={hasPrev}
      hasNext={hasNext}
      onPrev={onPrev}
      onNext={onNext}
    >
      <div>SLIDE</div>
    </SlideNavZones>,
  )
  return { onPrev, onNext }
}

describe('SlideNavZones', () => {
  it('navigates on zone clicks', () => {
    const { onPrev, onNext } = renderZones(true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
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
