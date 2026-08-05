/**
 * Unit tests for the complimentary plan grant control (ADMIN-9).
 *
 * What is asserted is mostly what it refuses to offer: only tiers above what
 * the account already pays for, nothing at all once it is on the largest
 * plan, and no submission without the expiry that makes it a grant rather
 * than an upgrade. The server enforces all three; a control that let an
 * operator choose a refusal would just be lying to them first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AdminPlanGrant, PlanTier } from '@slide-machine/shared'
import { setAccessToken } from '../auth/token'
import PlanGrantEditor from './PlanGrantEditor'
import { mockFetchRoutes } from '../test/fetch-mock'

const grant = (over: Partial<AdminPlanGrant> = {}): AdminPlanGrant => ({
  tier: 'pro',
  expiresAt: '2026-09-30T23:59:59.999Z',
  grantedAt: '2026-08-01T00:00:00.000Z',
  grantedByEmail: 'admin@example.com',
  inEffect: true,
  ...over,
})

const onChanged = vi.fn()

const renderEditor = ({
  billingTier = 'free' as const,
  current,
  status = 204,
  error,
}: {
  billingTier?: PlanTier
  current?: AdminPlanGrant
  status?: number
  error?: { code: string; message: string }
} = {}) => {
  const mocked = mockFetchRoutes({
    '/api/admin/users/u9/plan-grant': () => ({
      status,
      body: error ? { error } : undefined,
    }),
  })
  setAccessToken('t')
  render(
    <PlanGrantEditor
      userId="u9"
      billingTier={billingTier}
      grant={current}
      onChanged={onChanged}
    />,
  )
  return mocked
}

/** The requests sent so far, as [method, body] pairs. */
const sent = (fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock']) =>
  fetchMock.mock.calls.map(([, init]) => [init?.method, String(init?.body)])

beforeEach(() => {
  onChanged.mockClear()
  setAccessToken(null)
})
afterEach(() => vi.unstubAllGlobals())

describe('PlanGrantEditor', () => {
  it('offers only plans larger than the one the account pays for', () => {
    renderEditor({ billingTier: 'pro' })

    const options = screen
      .getAllByRole('option')
      .map(o => (o as HTMLOptionElement).value)
    expect(options).toEqual(['max'])
  })

  it('offers nothing to an account already on the largest plan', () => {
    renderEditor({ billingTier: 'max' })

    expect(screen.getByText(/already on the largest plan/i)).toBeVisible()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('sends the chosen tier and date, then re-reads the account', async () => {
    const { fetchMock } = renderEditor({ billingTier: 'fresh' })

    fireEvent.change(screen.getByLabelText('Plan'), {
      target: { value: 'pro' },
    })
    fireEvent.change(screen.getByLabelText('Last day'), {
      target: { value: '2026-09-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(sent(fetchMock)).toEqual([
      ['PUT', JSON.stringify({ tier: 'pro', expiresAt: '2026-09-30' })],
    ])
  })

  // The expiry is the whole difference between a grant and an upgrade, so
  // the form will not submit without one.
  it('refuses to submit without an expiry', async () => {
    const { fetchMock } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/last day/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('shows what is in force and offers to end it', async () => {
    const { fetchMock } = renderEditor({ current: grant() })

    expect(screen.getByText(/Complimentary Pro until/)).toBeVisible()
    expect(screen.getByText(/back to Free/)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'End now' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(sent(fetchMock)).toEqual([['DELETE', 'undefined']])
  })

  // History, not clutter: a lapsed grant is what explains the usage on an
  // account that was comped last month.
  it('keeps a lapsed grant on screen, as something ended', () => {
    renderEditor({ current: grant({ inEffect: false }) })

    expect(screen.getByText(/A complimentary Pro ended/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'End now' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeVisible()
  })

  // The account is not the admin's, so a control that quietly snapped back
  // would leave them believing a plan had been given.
  it('reports the endpoint’s refusal rather than failing silently', async () => {
    renderEditor({
      billingTier: 'fresh',
      status: 400,
      error: {
        code: 'not_an_upgrade',
        message: 'This account is already on fresh',
      },
    })

    fireEvent.change(screen.getByLabelText('Last day'), {
      target: { value: '2026-09-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account is already on fresh',
    )
    expect(onChanged).not.toHaveBeenCalled()
  })
})
