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

  it('wraps both views in one bordered rectangle, highlighting the active one', () => {
    const { container } = render(
      <ViewModeToggle mode="list" onChange={() => {}} />,
    )
    // The border is what says "these two icons are one control"
    expect(container.querySelector('[role="group"]')).toHaveClass(
      'border',
      'rounded-lg',
    )
    expect(screen.getByRole('button', { name: 'List view' })).toHaveClass(
      'bg-indigo-50',
    )
    expect(
      screen.getByRole('button', { name: 'Carousel view' }),
    ).not.toHaveClass('bg-indigo-50')
  })

  it('labels each view on hover', () => {
    render(<ViewModeToggle mode="list" onChange={() => {}} />)
    // Icon-only buttons: the tooltip is what says what they do
    expect(screen.getByText('Carousel view')).toBeInTheDocument()
    expect(screen.getByText('List view')).toBeInTheDocument()
  })
})
