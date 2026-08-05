/**
 * Unit tests for the public shell: logo left; the profile icon on the
 * right opens the profile when signed in and login otherwise.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import PublicShell from './PublicShell'
import { ShellTitle, ShellTitleProvider } from './ShellTitle'
import { mockFetchRoutes } from '../../test/fetch-mock'

const renderShell = (refreshStatus: number) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      refreshStatus === 200
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
  })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<PublicShell />}>
            <Route path="/" element={<div>PAGE</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PublicShell', () => {
  it('offers a profile link in the menu for signed-in users', async () => {
    renderShell(200)
    await screen.findByText('PAGE')
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
        'href',
        '/u/u1',
      ),
    )
  })

  it('offers a log-in link in the menu for anonymous visitors', async () => {
    renderShell(401)
    await screen.findByText('PAGE')
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menuitem', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  it('brands home on the left', async () => {
    renderShell(401)
    expect(
      await screen.findByRole('link', { name: /slide machine/i }),
    ).toHaveAttribute('href', '/')
  })

  it('shows the app badge inside the home link, after the menu button', async () => {
    renderShell(401)
    const brand = await screen.findByRole('link', { name: /slide machine/i })
    const badge = brand.querySelector('img')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('src', expect.stringContaining('badge'))
    expect(badge).toHaveAttribute('alt', '')
    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(
      menu.compareDocumentPosition(badge as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps the badge home link when a page teleports its own title', async () => {
    // What a lecture page does: its own title takes the header, and the
    // badge stays beside the hamburger as the way home. Only the brand
    // words give way, since the header has no room for both.
    mockFetchRoutes({ '/api/auth/refresh': () => ({ status: 401 }) })
    render(
      <MemoryRouter initialEntries={['/d/waves-abc123']}>
        <AuthProvider>
          <ShellTitleProvider>
            <Routes>
              <Route element={<PublicShell />}>
                <Route
                  path="/d/:slug"
                  element={
                    <ShellTitle>
                      <span>Waves</span>
                    </ShellTitle>
                  }
                />
              </Route>
            </Routes>
          </ShellTitleProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    const brand = await screen.findByRole('link', { name: /slide machine/i })
    expect(brand).toHaveAttribute('href', '/')
    expect(brand.querySelector('img')).toBeInTheDocument()
    // The words are gone; the lecture's own title has the space
    expect(brand).toHaveTextContent('')
    expect(await screen.findByText('Waves')).toBeInTheDocument()
  })
})
