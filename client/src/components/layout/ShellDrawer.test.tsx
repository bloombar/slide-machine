/**
 * Unit tests for the sliding nav drawer: opening it pushes the framed page
 * aside instead of covering it, the panel slides in from the left rather
 * than appearing, the hamburger bars cross into a close icon, and clicking
 * the pushed page puts everything back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../../auth/AuthContext'
import { setAccessToken } from '../../auth/token'
import { resetAdminStatus } from '../../hooks/useIsAdmin'
import ShellMenu from './ShellMenu'
import { ShellDrawerFrame } from './ShellDrawer'
import { mockFetchRoutes } from '../../test/fetch-mock'

const renderFrame = () => {
  mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
    }),
    '/api/admin/status': () => ({ status: 403 }),
  })
  const view = render(
    <MemoryRouter>
      <AuthProvider>
        <ShellDrawerFrame>
          <ShellMenu />
          <p>Page content</p>
        </ShellDrawerFrame>
      </AuthProvider>
    </MemoryRouter>,
  )
  // The layer the frame slides: the clipping wrapper's only child
  const shifted = view.container.firstElementChild!.firstElementChild!
  const panel = document.querySelector('[role="menu"]')!
  return { ...view, shifted, panel }
}

const toggle = () => screen.getByRole('button', { name: 'Menu' })

beforeEach(() => {
  setAccessToken(null)
  resetAdminStatus()
})
afterEach(() => vi.unstubAllGlobals())

describe('ShellDrawerFrame', () => {
  it('pushes the page aside and slides the panel in when opened', () => {
    const { shifted, panel } = renderFrame()
    expect(shifted).not.toHaveClass('translate-x-0')
    expect(panel).toHaveClass('-translate-x-full')
    expect(panel).toHaveClass('transition-transform')

    fireEvent.click(toggle())
    expect(shifted).toHaveClass('translate-x-64')
    expect(panel).toHaveClass('translate-x-0')
    expect(shifted).toHaveClass('transition-transform')
  })

  it('puts the page back when closed again', () => {
    const { shifted, panel } = renderFrame()
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    expect(shifted).not.toHaveClass('translate-x-64')
    expect(panel).toHaveClass('-translate-x-full')
  })

  it('carries no translate at all while closed', () => {
    // The regression: `translate-x-0` is `translate: 0`, not `none`, which
    // makes this layer the containing block for every `position: fixed`
    // descendant — the dragged deck toolbar was then placed against the
    // document and flew off-screen by the page's scroll offset.
    const { shifted } = renderFrame()
    expect(shifted.className).not.toMatch(/translate-x/)

    fireEvent.click(toggle())
    expect(shifted).toHaveClass('translate-x-64')
  })

  it('crosses the hamburger bars into a close icon while open', () => {
    renderFrame()
    const bars = () =>
      Array.from(toggle().querySelectorAll(':scope > span > span'))
    expect(bars()).toHaveLength(3)
    expect(bars().map(b => b.className)).toEqual([
      expect.stringContaining('-translate-y-1.5'),
      expect.stringContaining('opacity-100'),
      expect.stringContaining('translate-y-1.5'),
    ])

    fireEvent.click(toggle())
    expect(bars().map(b => b.className)).toEqual([
      expect.stringContaining('rotate-45'),
      expect.stringContaining('opacity-0'),
      expect.stringContaining('-rotate-45'),
    ])
  })

  it('pins the toggle where it stood, leaving the header a gap', () => {
    const { shifted } = renderFrame()
    expect(shifted).toContainElement(toggle())

    fireEvent.click(toggle())
    // One toggle, still: the header's is gone and the drawer's stands in
    // its place, fixed to the viewport so the page slides out from under it
    expect(screen.getAllByRole('button', { name: 'Menu' })).toHaveLength(1)
    expect(shifted).not.toContainElement(toggle())
    expect(toggle()).toHaveClass('fixed')
    // …with its space in the header held open behind the drawer
    expect(shifted.querySelector('span[aria-hidden]')).toBeTruthy()
  })

  it('closes when the pushed page is clicked', async () => {
    renderFrame()
    fireEvent.click(toggle())
    expect(await screen.findByRole('menuitem', { name: 'Home' })).toBeVisible()

    fireEvent.pointerDown(screen.getByText('Page content'))
    expect(
      screen.queryByRole('menuitem', { name: 'Home' }),
    ).not.toBeInTheDocument()
  })

  it('leaves clicks inside the panel alone', async () => {
    renderFrame()
    fireEvent.click(toggle())
    const home = await screen.findByRole('menuitem', { name: 'Home' })
    fireEvent.pointerDown(home)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
