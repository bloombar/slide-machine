/**
 * Unit tests for VoteCount (SOC-1): a browsable list reports how many people
 * voted, not which way it went — four in favour and five against is nine
 * votes. Singular and zero read correctly, and it is never a control.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VoteCount from './VoteCount'

describe('VoteCount', () => {
  it('totals both directions (4 up + 5 down reads as 9 votes)', () => {
    render(<VoteCount up={4} down={5} />)
    expect(screen.getByText('9 votes')).toBeInTheDocument()
  })

  it('says one vote, not 1 votes', () => {
    render(<VoteCount up={1} down={0} />)
    expect(screen.getByText('1 vote')).toBeInTheDocument()
  })

  it('shows zero rather than nothing when nobody has voted', () => {
    render(<VoteCount up={0} down={0} />)
    expect(screen.getByText('0 votes')).toBeInTheDocument()
  })

  it('keeps the split available as a tooltip', () => {
    const { container } = render(<VoteCount up={4} down={5} />)
    expect(container.querySelector('[title]')).toHaveAttribute(
      'title',
      '4 up · 5 down',
    )
  })

  it('is display-only — it offers nothing to click', () => {
    render(<VoteCount up={3} down={2} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
