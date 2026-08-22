/**
 * Unit tests for the app shell: primary navigation links and content
 * outlet rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import AppShell from './AppShell'
import { mockFetchRoutes } from '../../test/fetch-mock'
import { getBadgeUrl } from './badge'

beforeEach(() => {
  setAccessToken(null)
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/app" element={<div>HOME CONTENT</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

describe('AppShell', () => {
  it('renders the primary nav with a hamburger menu, not a standalone profile link', () => {
    renderShell()
    expect(
      screen.getByRole('navigation', { name: 'Primary' }),
    ).toBeInTheDocument()
    // The menu replaces the old standalone profile icon in the nav
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Profile' }),
    ).not.toBeInTheDocument()
  })

  it('brands back to the app home and renders the page content', () => {
    renderShell()
    expect(
      screen.getByRole('link', { name: /slide machine/i }),
    ).toHaveAttribute('href', '/app')
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument()
  })

  it('shows the app badge inside the home link, after the menu button', () => {
    const { container } = renderShell()
    const brand = screen.getByRole('link', { name: /slide machine/i })
    const badge = brand.querySelector('img')
    expect(badge).toBeInTheDocument()
    // Vite inlines the mark, so the src is a data: URI rather than a
    // filename — what matters is that it is the badge the app ships.
    expect(badge).toHaveAttribute('src', getBadgeUrl())
    // Decorative: the link's own label already names the destination
    expect(badge).toHaveAttribute('alt', '')
    // Badge sits between the hamburger button and the title text
    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(
      menu.compareDocumentPosition(badge as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(container.textContent).toContain('The Slide Machine')
  })
})
