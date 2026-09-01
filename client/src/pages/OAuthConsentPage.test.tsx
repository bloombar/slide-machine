/**
 * Unit tests for the consent screen (docs/MCP.md §5.1).
 *
 * This is the only gate between an assistant anybody can register and an
 * instructor's lecture material, so the tests are about what the person is
 * actually told and what each button does — not about markup. In particular:
 * declining must be as available as accepting, and must send the refusal back
 * to the assistant rather than leaving it hanging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import OAuthConsentPage from './OAuthConsentPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const REQUEST = {
  clientName: 'Claude',
  scopes: [
    { scope: 'lectures.read', description: 'See your lectures and slides' },
    { scope: 'lectures.write', description: 'Create and change lectures' },
  ],
}

const renderPage = ({
  search = '?request=req-1',
  authorization = () => ({ status: 200, body: REQUEST }),
  approve = () => ({
    status: 200,
    body: { redirectTo: 'https://assistant.test/cb?code=abc' },
  }),
  deny = () => ({
    status: 200,
    body: { redirectTo: 'https://assistant.test/cb?error=access_denied' },
  }),
}: {
  search?: string
  authorization?: () => { status: number; body?: unknown }
  approve?: () => { status: number; body?: unknown }
  deny?: () => { status: number; body?: unknown }
} = {}) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: {
        user: { id: 'u1', displayName: 'Ada', email: 'ada@example.com' },
        accessToken: 't',
      },
    }),
    '/approve': approve,
    '/deny': deny,
    '/api/oauth/authorization/': authorization,
  })
  render(
    <MemoryRouter initialEntries={[{ pathname: '/oauth/consent', search }]}>
      <AuthProvider>
        <OAuthConsentPage />
      </AuthProvider>
    </MemoryRouter>,
  )
  return mock
}

/** The page leaves the app on both answers, so navigation is stubbed. */
let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  assign = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { assign, href: 'http://localhost/oauth/consent' },
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('what the user is told', () => {
  it('names the assistant and every permission it asked for', async () => {
    renderPage()

    expect(await screen.findByText(/Claude is asking/)).toBeTruthy()
    expect(screen.getByText('See your lectures and slides')).toBeTruthy()
    expect(screen.getByText('Create and change lectures')).toBeTruthy()
  })

  it('states the limits on the screen where the decision is made', async () => {
    // What the assistant cannot do is most of what makes saying yes
    // reasonable, so it is not left to be discovered later.
    renderPage()
    expect(await screen.findByText(/cannot delete anything/)).toBeTruthy()
    expect(screen.getByText(/disconnect it at any time/)).toBeTruthy()
  })

  it('offers declining as plainly as allowing', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Allow' })).toBeTruthy()
    expect(screen.getByRole('button', { name: "Don't allow" })).toBeTruthy()
  })
})

describe('answering', () => {
  it('sends the browser back to the assistant with a code', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://assistant.test/cb?code=abc'),
    )
  })

  it('sends a refusal back too, rather than leaving the assistant hanging', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: "Don't allow" }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'https://assistant.test/cb?error=access_denied',
      ),
    )
  })

  it('cannot be answered twice by an impatient double-click', async () => {
    const { calls } = renderPage()
    const allow = await screen.findByRole('button', { name: 'Allow' })
    fireEvent.click(allow)
    fireEvent.click(allow)

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(calls.filter(url => url.includes('/approve'))).toHaveLength(1)
  })

  it('says so, and stays put, when the answer could not be recorded', async () => {
    renderPage({ approve: () => ({ status: 500 }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))

    expect(await screen.findByText(/nothing was connected/)).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('requests that cannot be answered', () => {
  it('explains an expired or already-answered request in one message', async () => {
    // Missing, expired and already-answered are deliberately indistinguishable
    // on the server, so the screen does not pretend to tell them apart.
    renderPage({ authorization: () => ({ status: 404 }) })
    expect(
      await screen.findByText(/expired or was already answered/),
    ).toBeTruthy()
  })

  it('handles a URL with no request in it at all', async () => {
    renderPage({ search: '' })
    expect(
      await screen.findByText(/expired or was already answered/),
    ).toBeTruthy()
  })

  it.each([
    ['an answer', { ok: true, status: 200, json: async () => REQUEST }],
    ['a failure', { ok: false, status: 500, json: async () => ({}) }],
  ])(
    'drops %s that arrives after the user has navigated away',
    async (_label, response) => {
      // A consent screen is a page people leave halfway through by design, so
      // both the success and failure paths guard against a setState landing on
      // an unmounted component.
      let settle: (value: Response) => void = () => {}
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).includes('/api/auth/refresh')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                user: { id: 'u1', displayName: 'Ada', email: 'a@b.test' },
                accessToken: 't',
              }),
            } as Response
          }
          return new Promise<Response>(resolve => {
            settle = resolve
          })
        }),
      )

      const view = render(
        <MemoryRouter
          initialEntries={[
            { pathname: '/oauth/consent', search: '?request=r' },
          ]}
        >
          <AuthProvider>
            <OAuthConsentPage />
          </AuthProvider>
        </MemoryRouter>,
      )
      await waitFor(() => expect(settle).toBeInstanceOf(Function))

      view.unmount()
      settle(response as unknown as Response)
      await Promise.resolve()

      // The card is gone and stays gone: the late answer updated nothing.
      expect(screen.queryByText(/Claude is asking/)).toBeNull()
    },
  )

  it('reports a server failure without inviting a pointless retry loop', async () => {
    renderPage({ authorization: () => ({ status: 500 }) })
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy()
  })
})
