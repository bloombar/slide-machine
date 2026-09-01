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
    // Every feature card, in reading order: one lost to a key typo fails
    // here, and so does one that quietly moves.
    const headings = screen
      .getByRole('heading', { name: 'What it does' })
      .parentElement!.querySelectorAll('h3')
    expect([...headings].map(h => h.textContent)).toEqual([
      'Slides written as you speak',
      'Seeded from your own material',
      'Exit-ticket quizzes',
      'A whiteboard over any slide',
      'Translated, and read aloud',
      'Editable and exportable afterwards',
      'Made from your AI assistant',
    ])
  })

  // The assistant card is the one feature a visitor cannot discover by
  // using the app, so the homepage has to name the standard it runs on.
  it('names MCP on the assistant card', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    const card = screen
      .getByRole('heading', { name: 'Made from your AI assistant' })
      .closest('div')!.parentElement!
    expect(card.textContent).toContain('MCP')
    expect(card.textContent).toContain('Claude')
    expect(card.textContent).toContain('ChatGPT')
  })

  it('gives every feature card an icon, decorative rather than announced', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    // One icon per card, beside the wording rather than instead of it: the
    // headings above still carry the meaning for a screen reader.
    const cards = screen
      .getByRole('heading', { name: 'What it does' })
      .parentElement!.querySelectorAll('svg[aria-hidden]')
    expect(cards).toHaveLength(7)
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

  it('names the narrow scope and its limits', async () => {
    renderLanding(401)
    await screen.findByRole('heading', { name: 'The Slide Machine' })

    const body = document.body.textContent ?? ''
    // The narrow scope is the whole point of the disclosure: the page has to
    // say that the least possible permission is requested and that it cannot
    // read the rest of the Drive.
    expect(body).toContain('least possible permission')
    expect(body).toContain(
      'cannot and do not view, search, or read the rest of your Google Drive',
    )
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
      screen.getByRole('link', { name: /sign in to start/i }),
    ).toHaveAttribute('href', '/login')
    // Registration is reached from the sign-in page, not from a second
    // button competing with the first
    expect(
      screen.queryByRole('link', { name: /create an account/i }),
    ).toBeNull()
  })
})
