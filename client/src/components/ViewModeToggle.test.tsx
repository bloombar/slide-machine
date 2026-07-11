/**
 * Unit tests for the shared view-mode toggle.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ViewModeToggle from './ViewModeToggle'

describe('ViewModeToggle', () => {
  it('marks the active mode pressed', () => {
    render(<ViewModeToggle mode="list" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Carousel view' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports mode changes', () => {
    const onChange = vi.fn()
    render(<ViewModeToggle mode="carousel" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(onChange).toHaveBeenCalledWith('list')
  })
})
