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
    render(<FreedomSlider inheritedValue={3} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'AI freedom' })
    expect(slider).toHaveValue('3')
    // Inheriting: no status line, no reset, no numeric readout
    expect(
      screen.queryByRole('button', { name: 'Reset to default' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('3/5')).not.toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '4' } })
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledWith(4)
    vi.useRealTimers()
  })

  it('offers Reset to default only when a value is set at this level', () => {
    const onChange = vi.fn()
    render(<FreedomSlider value={5} inheritedValue={3} onChange={onChange} />)
    expect(screen.getByRole('slider', { name: 'AI freedom' })).toHaveValue('5')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
