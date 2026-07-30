/**
 * Unit tests for the admin nav bar: it links every admin section and marks
 * the current one, including from that section's detail pages.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminNav, { ADMIN_LINKS } from './AdminNav'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminNav />
    </MemoryRouter>,
  )

/** The label of the tab marked aria-current, or undefined when none is. */
const currentLabel = (): string | undefined =>
  screen
    .getAllByRole('link')
    .find(link => link.getAttribute('aria-current') === 'page')?.textContent ??
  undefined

describe('AdminNav', () => {
  it('links every admin section', () => {
    renderAt('/app/admin')
    const nav = screen.getByRole('navigation', { name: 'Admin' })
    expect(nav).toBeInTheDocument()
    for (const link of ADMIN_LINKS) {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute(
        'href',
        link.to,
      )
    }
  })

  it.each([
    ['/app/admin', 'Users'],
    ['/app/admin/users/u1', 'Users'],
    ['/app/admin/projects', 'Projects'],
    ['/app/admin/projects/p1', 'Projects'],
    ['/app/admin/decks', 'Lectures'],
    ['/app/admin/decks/d1', 'Lectures'],
    ['/app/admin/logs', 'Admin Logs'],
    ['/app/admin/settings-logs', 'User Logs'],
  ])('marks %s as being in the %s section', (path, label) => {
    renderAt(path)
    expect(currentLabel()).toBe(label)
  })

  it('marks exactly one tab current, so nested paths do not also match Users', () => {
    renderAt('/app/admin/projects/p1')
    const marked = screen
      .getAllByRole('link')
      .filter(link => link.getAttribute('aria-current') === 'page')
    expect(marked).toHaveLength(1)
  })
})
