/**
 * Unit tests for the feedback form: what it posts, what it asks a signed-in
 * sender versus a visitor, what it does once the message has gone, and what
 * it says when it cannot send.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import * as runtimeConfig from '../runtime-config'
import FeedbackPage from './FeedbackPage'
import { mockFetchRoutes } from '../test/fetch-mock'

/** Renders the page, signed in or not, optionally opened from `from`. */
const renderPage = ({
  authed = false,
  from,
  feedback = () => ({ status: 202, body: { sent: true } }),
}: {
  authed?: boolean
  from?: string
  feedback?: () => { status: number; body?: unknown }
} = {}) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () =>
      authed
        ? {
            status: 200,
            body: {
              user: { id: 'u1', displayName: 'Ada', email: 'ada@example.com' },
              accessToken: 't',
            },
          }
        : { status: 401 },
    '/api/feedback': feedback,
  })
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/feedback', state: from ? { from } : null },
      ]}
    >
      <AuthProvider>
        <FeedbackPage />
      </AuthProvider>
    </MemoryRouter>,
  )
  return mock
}

/** Fills the two required fields. */
const fillForm = (subject = 'Slides stop advancing', message = 'It froze.') => {
  fireEvent.change(screen.getByLabelText('Summary'), {
    target: { value: subject },
  })
  fireEvent.change(screen.getByLabelText('Details'), {
    target: { value: message },
  })
}

const send = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

/** The body of the one POST the page made. */
const posted = (fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock']) => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/feedback'),
  )
  return JSON.parse(String((call![1] as RequestInit).body))
}

beforeEach(() => {
  setAccessToken(null)
  vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FeedbackPage', () => {
  it('posts the message, and says it went', async () => {
    const { fetchMock } = renderPage()
    fillForm()
    send()
    expect(
      await screen.findByRole('heading', { name: 'Thank you' }),
    ).toBeInTheDocument()
    expect(posted(fetchMock)).toEqual({
      kind: 'bug',
      subject: 'Slides stop advancing',
      message: 'It froze.',
    })
  })

  it('sends the kind the sender chose', async () => {
    const { fetchMock } = renderPage()
    fillForm()
    fireEvent.click(screen.getByLabelText(/Something is missing/))
    send()
    await screen.findByRole('heading', { name: 'Thank you' })
    expect(posted(fetchMock).kind).toBe('feature')
  })

  // A visitor has no account for us to reply to, so the form asks — and
  // accepts a blank, which is what staying anonymous looks like.
  it('offers a visitor somewhere to leave an address', async () => {
    const { fetchMock } = renderPage()
    fillForm()
    fireEvent.change(screen.getByLabelText(/Your email/), {
      target: { value: 'ada@example.com' },
    })
    send()
    await screen.findByRole('heading', { name: 'Thank you' })
    expect(posted(fetchMock).email).toBe('ada@example.com')
  })

  it('omits the address when the visitor leaves it blank', async () => {
    const { fetchMock } = renderPage()
    fillForm()
    send()
    await screen.findByRole('heading', { name: 'Thank you' })
    expect(posted(fetchMock)).not.toHaveProperty('email')
  })

  // The server takes a signed-in sender's address from their token, so
  // asking for one again would only invite a second, contradictory answer.
  it('does not ask a signed-in sender for their address', async () => {
    renderPage({ authed: true })
    expect(await screen.findByText(/Sent from your account, Ada/)).toBeVisible()
    expect(screen.queryByLabelText(/Your email/)).not.toBeInTheDocument()
  })

  it('carries the page it was opened from', async () => {
    const { fetchMock } = renderPage({ from: '/app/projects/p1' })
    fillForm()
    send()
    await screen.findByRole('heading', { name: 'Thank you' })
    expect(posted(fetchMock).page).toBe('/app/projects/p1')
  })

  it('offers an empty form to a sender with more to say', async () => {
    renderPage()
    fillForm()
    send()
    fireEvent.click(await screen.findByRole('button', { name: 'Send another' }))
    expect(screen.getByLabelText('Summary')).toHaveValue('')
    expect(screen.getByLabelText('Details')).toHaveValue('')
  })

  // The API's own wording is the useful one: only it knows whether mail is
  // down or the sender is simply sending too fast.
  it('shows what the server said when the send fails', async () => {
    renderPage({
      feedback: () => ({
        status: 429,
        body: {
          error: {
            code: 'too_many_requests',
            message: 'Too many messages just now',
          },
        },
      }),
    })
    fillForm()
    send()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many messages just now',
    )
    expect(
      screen.queryByRole('heading', { name: 'Thank you' }),
    ).not.toBeInTheDocument()
  })

  it('leaves the form usable after a failed send', async () => {
    renderPage({
      feedback: () => ({
        status: 503,
        body: { error: { code: 'x', message: 'No' } },
      }),
    })
    fillForm()
    send()
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
    expect(screen.getByLabelText('Summary')).toHaveValue(
      'Slides stop advancing',
    )
  })

  // The menu hides the entry on a server that cannot send; someone reaching
  // the URL directly still deserves an explanation rather than a form that
  // refuses everything.
  it('explains itself when the server cannot send mail', () => {
    vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(false)
    renderPage()
    expect(
      screen.getByRole('heading', { name: 'Send feedback' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/not set up on this server/)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Send feedback' }),
    ).not.toBeInTheDocument()
  })

  it('counts what is left of the message allowance', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'four' },
    })
    expect(screen.getByText('4 of 5000 characters.')).toBeInTheDocument()
  })

  it('links to the privacy policy beside the send button', () => {
    renderPage()
    expect(
      screen.getByRole('link', { name: 'privacy policy' }),
    ).toHaveAttribute('href', '/privacy')
  })
})

// The form submits through a real <form>, so a missing required field is the
// browser's business — jsdom does not enforce it, hence no test for it here;
// the server rejects an empty message either way (routes/feedback.test.ts).
