/**
 * Unit tests for the post-sign-in account-type prompt (AUTH-6): it appears
 * only while the answer is missing, sends the chosen one, disappears once
 * the account carries it, and cannot be dismissed without answering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import AccountTypePrompt from './AccountTypePrompt'
import { mockFetchRoutes } from '../test/fetch-mock'

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  ...over,
})

/** Renders the prompt for a restored session. `over` shapes the account,
 * which is the only thing that decides whether the prompt shows at all. */
const renderPrompt = (
  over: Record<string, unknown> = {},
  routes: Record<string, Handler> = {},
) => {
  const mock = mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: user(over), accessToken: 't' },
    }),
    ...routes,
  })
  render(
    <AuthProvider>
      <AccountTypePrompt />
    </AuthProvider>,
  )
  return mock
}

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

describe('AccountTypePrompt', () => {
  it('asks an account that has not answered yet', async () => {
    renderPrompt()
    expect(
      await screen.findByRole('heading', { name: 'Which best describes you?' }),
    ).toBeVisible()
    for (const label of ['Student', 'Educator', 'Other']) {
      expect(
        screen.getByRole('button', { name: new RegExp(label) }),
      ).toBeVisible()
    }
  })

  it('says what the answer changes, and that it is not final', async () => {
    renderPrompt()
    expect(
      await screen.findByText(
        /only chooses the privacy your work starts with/i,
      ),
    ).toBeVisible()
    expect(screen.getByText(/change this any time in Settings/i)).toBeVisible()
    // The consequence is on the choice itself, not buried in a policy page
    expect(
      screen.getByText('Your profile and new lectures start private.'),
    ).toBeVisible()
  })

  it('does not ask an account that has answered', async () => {
    renderPrompt({ accountType: 'educator' })
    // Nothing to wait for, so let the session restore settle first
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('heading', { name: /describes you/i })).toBeNull()
  })

  it('sends the chosen type and closes on the account it returns', async () => {
    const { fetchMock } = renderPrompt(
      {},
      {
        '/api/actions/user.setAccountType': () => ({
          status: 200,
          body: user({ accountType: 'student', profileVisibility: 'private' }),
        }),
      },
    )
    fireEvent.click(await screen.findByRole('button', { name: /Student/ }))

    await vi.waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /describes you/i }),
      ).toBeNull(),
    )
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('user.setAccountType'),
    )
    expect(call).toBeDefined()
    expect(JSON.parse(String(call![1]!.body))).toEqual({
      accountType: 'student',
    })
  })

  it('stays open and reports a failure so the answer can be retried', async () => {
    renderPrompt(
      {},
      {
        '/api/actions/user.setAccountType': () => ({
          status: 500,
          body: { error: { code: 'internal_error', message: 'nope' } },
        }),
      },
    )
    fireEvent.click(await screen.findByRole('button', { name: /Educator/ }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Which best describes you?' }),
    ).toBeVisible()
    // Re-enabled, so the retry is one more click
    expect(screen.getByRole('button', { name: /Educator/ })).toBeEnabled()
  })

  it('cannot be dismissed without answering', async () => {
    renderPrompt()
    const heading = await screen.findByRole('heading', {
      name: 'Which best describes you?',
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(heading).toBeVisible()
  })
})
