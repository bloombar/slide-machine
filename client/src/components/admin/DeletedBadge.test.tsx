/**
 * Unit tests for the admin console's "Deleted" pill (ADMIN-6): it marks a
 * soft-deleted record, carries the deletion time as its tooltip, and
 * renders nothing at all for a live one.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DeletedBadge, { deletedTextClass } from './DeletedBadge'
import { formatAdminDate } from '../../lib/date'

describe('DeletedBadge', () => {
  it('renders nothing for a live record', () => {
    const { container } = render(<DeletedBadge />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty tombstone', () => {
    const { container } = render(<DeletedBadge deletedAt="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels a soft-deleted record and dates it in the tooltip', () => {
    const at = '2026-07-20T09:00:00Z'
    render(<DeletedBadge deletedAt={at} />)
    const pill = screen.getByText('Deleted')
    expect(pill).toBeVisible()
    expect(pill).toHaveAttribute('title', `Deleted ${formatAdminDate(at)}`)
  })

  it('exports the muted class the pages pair it with', () => {
    expect(deletedTextClass).toContain('text-slate-400')
  })
})
