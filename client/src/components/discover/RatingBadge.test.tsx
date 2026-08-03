/**
 * Unit tests for the RatingBadge (SOC-1): one icon, one number — the net score,
 * shown for positive, negative, and zero ratings, and never as a control.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RatingBadge from './RatingBadge'

describe('RatingBadge', () => {
  it('shows the net score (4 up minus 2 down reads as 2)', () => {
    render(<RatingBadge score={2} />)
    expect(screen.getByLabelText('Rating 2')).toHaveTextContent('2')
  })

  it('shows a negative net score', () => {
    render(<RatingBadge score={-3} />)
    expect(screen.getByLabelText('Rating -3')).toHaveTextContent('-3')
  })

  it('shows zero rather than nothing when a lecture has no votes', () => {
    render(<RatingBadge score={0} />)
    expect(screen.getByLabelText('Rating 0')).toHaveTextContent('0')
  })

  it('is display-only — it offers nothing to click', () => {
    render(<RatingBadge score={5} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
