/**
 * Unit tests for the landing page. Beyond the hero-versus-redirect split,
 * these pin the three things the page has to carry for Google's OAuth
 * homepage requirements (docs/GOOGLE_PRODUCTION_MODE.md §3.3): the app's
 * name, a description of what it does, and a plain statement of every kind
 * of user data it asks for — the Google ones by name.
 *
 * They assert on rendered copy rather than on keys, because it is the copy a
 * reviewer reads. A wording change failing here is the signal we want.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import LandingPage from './LandingPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const renderLanding = (refreshStatus: number) => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      refreshStatus === 200
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
    '/api/health': () => ({
      status: 200,
      body: {
        status: 'ok',
        environment: 'test',
        version: '0',
        uptime: 1,
        components: {
          mongo: { status: 'ok', detail: 'connected' },
          storage: { status: 'ok', detail: 'local disk' },
          gemini: { status: 'disabled', detail: 'not configured' },
          stt: { status: 'disabled', detail: 'browser (client-side)' },
        },
      },
    }),
  })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<div>HOME SCREEN</div>} />
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

describe('LandingPage', () => {
  it('shows the hero to anonymous visitors', async () => {
    renderLanding(401)
    expect(
      await screen.findByRole('heading', { name: 'The Slide Machine' }),
    ).toBeInTheDocument()
  })

  it('sends signed-in users to their home screen', async () => {
    renderLanding(200)
    expect(await screen.findByText('HOME SCREEN')).toBeInTheDocument()
  })

  it('describes what the app does, not just what it is called', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    expect(
      screen.getByRole('heading', { name: 'What it does' }),
    ).toBeInTheDocument()
    // Every feature card, so one lost to a key typo fails here
    for (const heading of [
      'Slides written as you speak',
      'Seeded from your own material',
      'A whiteboard over any slide',
      'Exit-ticket quizzes',
      'Translated, and read aloud',
      'Editable and exportable afterwards',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
  })

  it('states every kind of user data it asks for and why', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    expect(
      screen.getByRole('heading', { name: 'What we ask for, and why' }),
    ).toBeInTheDocument()
    const body = document.body.textContent ?? ''
    // The account, the two Google grants and the microphone each get a
    // disclosure of their own
    expect(body).toContain('Your account')
    expect(body).toContain('Google sign-in')
    expect(body).toContain('Connecting Google Drive')
    expect(body).toContain('Your microphone')
  })

  it('names the drive.file scope and its limits', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    const body = document.body.textContent ?? ''
    // The narrow scope is the whole point of the disclosure: the page has to
    // say which permission is requested and that it cannot read the Drive.
    expect(body).toContain('drive.file')
    expect(body).toContain('cannot list, search or read the rest of your Drive')
  })

  it('links to the privacy policy without needing the drawer', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    expect(
      screen.getByRole('link', { name: 'Privacy policy' }),
    ).toHaveAttribute('href', '/privacy')
  })

  it('offers one way in — the sign-in call to action', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    expect(
      screen.getByRole('link', { name: /sign in to get started/i }),
    ).toHaveAttribute('href', '/login')
    // Registration is reached from the sign-in page, not from a second
    // button competing with the first
    expect(
      screen.queryByRole('link', { name: /create an account/i }),
    ).toBeNull()
  })
})
