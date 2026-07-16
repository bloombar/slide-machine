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

  it('groups both views in one well, lifting the active one out of it', () => {
    const { container } = render(
      <ViewModeToggle mode="list" onChange={() => {}} />,
    )
    // The well is what says "these two icons are one control"
    expect(container.querySelector('[role="group"]')).toHaveClass(
      'bg-slate-200',
    )
    expect(screen.getByRole('button', { name: 'List view' })).toHaveClass(
      'bg-white',
    )
    expect(
      screen.getByRole('button', { name: 'Carousel view' }),
    ).not.toHaveClass('bg-white')
  })

  it('labels each view on hover', () => {
    render(<ViewModeToggle mode="list" onChange={() => {}} />)
    // Icon-only buttons: the tooltip is what says what they do
    expect(screen.getByText('Carousel view')).toBeInTheDocument()
    expect(screen.getByText('List view')).toBeInTheDocument()
  })
})
