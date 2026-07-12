/**
 * Unit tests for the AI-freedom slider: debounced saves, inheritance
 * display, and the re-inherit reset.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FreedomSlider from './FreedomSlider'

describe('FreedomSlider', () => {
  it('shows the inherited value and saves a moved slider after debounce', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(
      <FreedomSlider
        inheritedValue={3}
        inheritedLabel="project setting"
        onChange={onChange}
      />,
    )
    const slider = screen.getByRole('slider', { name: 'AI freedom' })
    expect(slider).toHaveValue('3')
    expect(
      screen.getByText(/using the project setting \(3\/10\)/i),
    ).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '7' } })
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledWith(7)
    vi.useRealTimers()
  })

  it('offers re-inheriting when a value is set at this level', () => {
    const onChange = vi.fn()
    render(
      <FreedomSlider
        value={9}
        inheritedValue={3}
        inheritedLabel="server default"
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('slider', { name: 'AI freedom' })).toHaveValue('9')
    fireEvent.click(screen.getByRole('button', { name: 'Use server default' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
