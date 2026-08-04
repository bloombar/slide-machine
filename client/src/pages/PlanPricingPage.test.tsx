/**
 * Unit tests for the plan-pricing page (BILL-1/BILL-5): the comparison table
 * and the one control per plan.
 *
 * What is asserted is mostly about honesty. The table has to say what each
 * plan allows in the same words the usage panel uses, the plan the account is
 * already on must read as *held* rather than as something to buy again, and
 * nothing may offer a checkout the server would refuse — an unpriced tier, or
 * a downgrade, which is a change to the subscription rather than a purchase.
 *
 * The step-down cases carry the weight of BILL-5: a smaller plan keeps lecture
 * audio for fewer days, so the recordings that puts past the limit have to be
 * named before the user agrees (P-10) — and nothing may change while the
 * dialog is still open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import type {
  BillingSummary,
  PlanCatalog,
  PlanChangeImpact,
} from '@slide-machine/shared'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import PlanPricingPage from './PlanPricingPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const user = {
  id: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  planTier: 'free',
  profileVisibility: 'public',
  locale: 'en',
}

/** Two metered rows, one from each allowance, which is all the table needs to
 * prove it groups and formats them. */
const catalog = (over: Partial<PlanCatalog> = {}): PlanCatalog =>
  ({
    metrics: [
      { metric: 'sttMinutes', allowance: 'instructor', unit: 'minutes' },
      {
        metric: 'audienceTtsCharacters',
        allowance: 'audience',
        unit: 'characters',
      },
    ],
    plans: [
      {
        tier: 'free',
        purchasable: false,
        price: null,
        features: ['liveCapture', 'quizzes'],
        caps: {
          sttMinutes: 75,
          audienceTtsCharacters: 25000,
          aiTokens: 5000000,
          ttsCharacters: 60000,
          diarizationMinutes: 40,
          audienceLocales: 1,
        },
        audioRetentionDays: 7,
      },
      {
        tier: 'pro',
        purchasable: true,
        price: {
          amountMinor: 2900,
          currency: 'usd',
          interval: 'month',
          intervalCount: 1,
        },
        features: ['liveCapture', 'quizzes'],
        caps: {
          sttMinutes: 600,
          audienceTtsCharacters: 450000,
          aiTokens: 7500000,
          ttsCharacters: 600000,
          diarizationMinutes: 350,
          audienceLocales: 15,
        },
        audioRetentionDays: 21,
      },
      {
        tier: 'max',
        purchasable: true,
        price: {
          amountMinor: 9900,
          currency: 'usd',
          interval: 'month',
          intervalCount: 1,
        },
        features: ['liveCapture', 'quizzes'],
        caps: {
          sttMinutes: 3300,
          audienceTtsCharacters: 700000,
          aiTokens: 65000000,
          ttsCharacters: 3300000,
          diarizationMinutes: 1100,
          audienceLocales: 27,
        },
        audioRetentionDays: null,
      },
    ],
    ...over,
  }) as PlanCatalog

const summary = (over: Partial<BillingSummary> = {}): BillingSummary => ({
  tier: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canManageBilling: false,
  purchasableTiers: ['pro', 'max'],
  ...over,
})

/** What stepping down to Pro from Max would cost: one lecture whose audio is
 * older than the smaller plan keeps (BILL-5/P-10). */
const impact = (over: Partial<PlanChangeImpact> = {}): PlanChangeImpact => ({
  tier: 'pro',
  currentTier: 'max',
  isDowngrade: true,
  currentRetentionDays: 30,
  nextRetentionDays: 21,
  recordingsRemoved: 2,
  lecturesAffected: 1,
  lectures: [{ deckId: 'd1', title: 'Week 4 — Sorting', recordings: 2 }],
  effective: 'immediately',
  effectiveAt: null,
  changeable: true,
  ...over,
})

/** Renders the page for a signed-in account. `plans: null` fails the catalog
 * load, which is the only thing the page cannot render without. */
const renderPage = ({
  plans = catalog(),
  billing = summary(),
  redirect = 'https://pay.test/session',
  checkoutStatus = 200,
  preview = impact(),
  changed,
  changeStatus = 200,
}: {
  plans?: PlanCatalog | null
  billing?: BillingSummary
  redirect?: string
  checkoutStatus?: number
  preview?: PlanChangeImpact
  changed?: BillingSummary
  changeStatus?: number
} = {}) => {
  const mocked = mockFetchRoutes({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user, accessToken: 't' },
    }),
    '/api/actions/billing.plans': () =>
      plans
        ? { status: 200, body: plans }
        : {
            status: 500,
            body: { error: { code: 'server_error', message: 'x' } },
          },
    '/api/actions/billing.summary': () => ({ status: 200, body: billing }),
    '/api/actions/billing.checkout': () =>
      checkoutStatus === 200
        ? { status: 200, body: { url: redirect } }
        : {
            status: checkoutStatus,
            body: { error: { code: 'billing_unavailable', message: 'busy' } },
          },
    '/api/actions/billing.portal': () => ({
      status: 200,
      body: { url: redirect },
    }),
    '/api/actions/billing.changePreview': () => ({
      status: 200,
      body: preview,
    }),
    '/api/actions/billing.change': () =>
      changeStatus === 200
        ? { status: 200, body: { summary: changed ?? billing } }
        : {
            status: changeStatus,
            body: {
              error: { code: 'billing_unavailable', message: 'busy' },
            },
          },
  })
  setAccessToken('t')
  render(
    <MemoryRouter initialEntries={['/app/plans']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/plans" element={<PlanPricingPage />} />
          <Route path="/app/settings" element={<div>SETTINGS PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return mocked
}

/** The row whose header cell is `label`, so a cap can be read per plan. */
const row = async (label: RegExp) =>
  (await screen.findByRole('rowheader', { name: label })).closest('tr')!

/** The row whose *name* is exactly `label` — the header also carries a hint,
 * and "Narration" would otherwise match "Narration for viewers" too. */
const rowNamed = async (label: string) => {
  const headers = await screen.findAllByRole('rowheader')
  const header = headers.find(th => th.firstElementChild?.textContent === label)
  if (!header) throw new Error(`No row labelled "${label}"`)
  return header.closest('tr')!
}

/** An account on the largest plan with a live subscription — the only state
 * from which every smaller plan, and cancelling, is on offer. */
const subscribed = summary({
  tier: 'max',
  status: 'active',
  canManageBilling: true,
})

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe('PlanPricingPage', () => {
  it('gives every plan a column, cheapest first', async () => {
    renderPage()

    // Scoped to the head: the group headings inside the body are column
    // headers too, and they head rows rather than plans.
    const head = (await screen.findByTestId('plan-table')).querySelector(
      'thead',
    )!
    const headers = within(head).getAllByRole('columnheader')
    // The first column heads the feature names, not a plan.
    expect(headers.slice(1).map(h => h.textContent)).toEqual([
      expect.stringContaining('Free'),
      expect.stringContaining('Pro'),
      expect.stringContaining('Max'),
    ])
  })

  it('quotes each plan’s price, and says which one costs nothing', async () => {
    renderPage()

    // Minor units in, money out: 2900 cents is $29.00 (BILL-2 — the provider
    // quotes the figure, this only formats it).
    expect(await screen.findByText('$29.00 per month')).toBeInTheDocument()
    expect(screen.getByText('$99.00 per month')).toBeInTheDocument()
    // The free tier has no price to quote, and says so rather than showing a
    // zero the provider would never charge.
    expect(screen.getByText('No charge')).toBeInTheDocument()
  })

  it('leaves a plan unpriced when the provider could not quote it', async () => {
    const plans = catalog()
    for (const plan of plans.plans) plan.price = null
    renderPage({ plans })

    // No price is better than a wrong one, and better than no page at all.
    await screen.findByRole('button', { name: /Upgrade to Pro/i })
    expect(screen.queryByText(/per month/)).toBeNull()
  })

  it('ticks the features every plan includes', async () => {
    renderPage()

    const features = await row(/Exit-ticket quizzes/i)
    // One tick per plan, and the tick has words for anyone not looking at it.
    expect(within(features).getAllByText('Included')).toHaveLength(3)
  })

  it('states each plan’s allowance in the unit it is metered in', async () => {
    renderPage()

    const stt = await row(/Audio recording time/i)
    const cells = within(stt).getAllByRole('cell')
    expect(cells.map(c => c.textContent)).toEqual([
      '75 min',
      '600 min',
      '3,300 min',
    ])
  })

  it('says how long each plan keeps recordings, and which keeps them for good', async () => {
    renderPage()

    const retention = await row(/Original audio retention/i)
    expect(
      within(retention)
        .getAllByRole('cell')
        .map(c => c.textContent),
    ).toEqual(['7 days', '21 days', 'Kept indefinitely'])
  })

  it('puts retention directly under the recording allowance it applies to', async () => {
    renderPage()

    // How much you may record, then how long what you recorded survives: the
    // two are one question, and reading them apart invites the wrong answer.
    const stt = await row(/Audio recording time/i)
    expect(stt.nextElementSibling).toHaveTextContent(/Original audio retention/)
  })

  it('states narration and translation allowances in everyday units', async () => {
    renderPage({
      plans: catalog({
        metrics: [
          {
            metric: 'ttsCharacters',
            allowance: 'instructor',
            unit: 'characters',
          },
          {
            metric: 'audienceLocales',
            allowance: 'audience',
            unit: 'count',
          },
        ],
      }),
    })

    // Narration is billed per character and read in minutes; a viewer
    // translation allowance is read in languages.
    const narration = await row(/^Narration/)
    expect(
      within(narration)
        .getAllByRole('cell')
        .map(c => c.textContent),
    ).toEqual([
      'about 67 min of narration',
      // Past a couple of hours, minutes stop being a number anyone reads.
      'about 11 h of narration',
      'about 61 h of narration',
    ])
  })

  it('says that generated narration and translations are only counted once', async () => {
    renderPage({
      plans: catalog({
        metrics: [
          {
            metric: 'ttsCharacters',
            allowance: 'instructor',
            unit: 'characters',
          },
          {
            metric: 'translationCharacters',
            allowance: 'instructor',
            unit: 'characters',
          },
          {
            metric: 'audienceTtsCharacters',
            allowance: 'audience',
            unit: 'characters',
          },
        ],
      }),
    })

    // Both are cached, and serving what is already there costs nothing and
    // debits nothing (BILL-3). Left unsaid, an allowance reads as though a
    // class of thirty listening to one slide spent it thirty times.
    expect(await rowNamed('Narration')).toHaveTextContent(/replaying it costs/i)
    expect(await rowNamed('Translation')).toHaveTextContent(
      /stored and reused/i,
    )
    expect(await rowNamed('Narration for viewers')).toHaveTextContent(
      /once per slide, however many people listen/i,
    )
  })

  it('names what the AI allowance counts, in millions', async () => {
    renderPage({
      plans: catalog({
        metrics: [
          { metric: 'aiTokens', allowance: 'instructor', unit: 'tokens' },
        ],
      }),
    })

    // A bare "5,000,000" says nothing about what is being counted, and is
    // read digit by digit.
    const ai = await rowNamed('AI generation')
    expect(
      within(ai)
        .getAllByRole('cell')
        .map(c => c.textContent),
    ).toEqual(['5M tokens', '7.5M tokens', '65M tokens'])
    // A token is not a unit anyone has intuitions about, so the row anchors it
    // to work the reader recognizes (docs/BILLING_COST_MODEL.md §4-5).
    expect(ai).toHaveTextContent(/one slide-generation request runs about/i)
  })

  it('explains what an allowance covers when the number alone would mislead', async () => {
    renderPage({
      plans: catalog({
        metrics: [
          {
            metric: 'diarizationMinutes',
            allowance: 'instructor',
            unit: 'minutes',
          },
        ],
      }),
    })

    // Speaker labelling now matches the recording allowance rather than
    // sitting below it, so the row has to say so — a bare minute count next
    // to an identical one reads as a duplicate unless it explains itself
    // (BILL-3).
    const diarization = await row(/Speaker identification/i)
    expect(diarization).toHaveTextContent(/matches your recording allowance/i)
  })

  it('separates the audience allowances from the instructor’s own', async () => {
    renderPage()

    // Both group headings are present, so a viewer-spent allowance is never
    // read as something the instructor's own work draws on (BILL-3).
    const heading = await screen.findByText('Your audience')
    expect(screen.getByText('Your allowances')).toBeInTheDocument()

    // And what makes that pool separate is said directly under the heading it
    // applies to: at the foot of the table it was a sentence attached to
    // nothing the reader could see.
    expect(heading.closest('tr')!.nextElementSibling).toHaveTextContent(
      /separate pool so a popular lecture never uses up your own/i,
    )
  })

  it('marks the plan the account is on instead of offering to sell it', async () => {
    renderPage({ billing: summary({ tier: 'pro' }) })

    expect(await screen.findByTestId('current-plan-pro')).toHaveTextContent(
      'Your plan',
    )
    expect(screen.queryByRole('button', { name: /Upgrade to Pro/i })).toBeNull()
  })

  it('offers only the plans above the current one', async () => {
    renderPage({ billing: summary({ tier: 'pro' }) })

    expect(
      await screen.findByRole('button', { name: /Upgrade to Max/i }),
    ).toBeInTheDocument()
    // This account has never subscribed, so there is nothing to step down
    // from — and the free tier cannot be checked out for at all.
    expect(
      screen.queryByRole('button', { name: /Cancel subscription/i }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /Switch to/i })).toBeNull()
  })

  it('sends the browser to the hosted checkout', async () => {
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: /Upgrade to Pro/i }),
    )

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://pay.test/session'),
    )
  })

  it('returns from checkout to the account’s plan tab, not to this page', async () => {
    const mocked = renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: /Upgrade to Pro/i }),
    )

    // The plan changes when the webhook says so, and the Plan tab is where
    // that is explained — so that is where the provider sends the browser.
    await waitFor(() => expect(assign).toHaveBeenCalled())
    const call = mocked.fetchMock.mock.calls.find(args =>
      String(args[0]).includes('billing.checkout'),
    )!
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      tier: 'pro',
      returnPath: '/app/settings?tab=plan',
    })
  })

  it('keeps the buttons disabled while the browser is on its way out', async () => {
    renderPage()

    const upgrade = await screen.findByRole('button', {
      name: /Upgrade to Pro/i,
    })
    fireEvent.click(upgrade)

    // A second checkout is never what a slow redirect meant.
    await waitFor(() => expect(upgrade).toBeDisabled())
  })

  it('re-enables the buttons when the provider could not be reached', async () => {
    renderPage({ checkoutStatus: 503 })

    fireEvent.click(
      await screen.findByRole('button', { name: /Upgrade to Pro/i }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not open the billing page/i,
    )
    expect(assign).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /Upgrade to Pro/i }),
    ).toBeEnabled()
  })

  it('hides the portal until the account has been billed', async () => {
    renderPage()

    await screen.findByRole('button', { name: /Upgrade to Pro/i })
    expect(screen.queryByRole('button', { name: /Manage billing/i })).toBeNull()
  })

  it('sends a subscriber to the portal for cards and invoices', async () => {
    renderPage({
      billing: summary({
        tier: 'pro',
        status: 'active',
        canManageBilling: true,
      }),
    })

    fireEvent.click(await screen.findByRole('button', { name: /Manage/i }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://pay.test/session'),
    )
  })

  it('invites the largest plan to get in touch rather than upgrade', async () => {
    renderPage({ billing: summary({ tier: 'max' }) })

    expect(await screen.findByText(/largest plan/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Upgrade/i })).toBeNull()
  })

  it('offers a subscriber every smaller plan, and cancelling', async () => {
    renderPage({ billing: subscribed })

    // Cancelling is what "moving to free" is, and it says so rather than
    // offering a plan that cannot be bought.
    expect(
      await screen.findByRole('button', { name: /Switch to Pro/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Cancel subscription/i }),
    ).toBeInTheDocument()
  })

  it('names the recordings a smaller plan would delete', async () => {
    renderPage({ billing: subscribed })

    fireEvent.click(await screen.findByTestId('downgrade-pro'))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/kept for 21 days instead of 30 days/i)
    expect(dialog).toHaveTextContent(
      /2 recordings are older than that and will be deleted/i,
    )
    // Named, because a bare count does not tell anyone whether the lecture
    // that matters is among them.
    expect(dialog).toHaveTextContent(/Week 4 — Sorting — 2 recordings/)
    expect(dialog).toHaveTextContent(/takes effect right away/i)
  })

  it('says how many lectures it did not list', async () => {
    renderPage({
      billing: subscribed,
      preview: impact({ recordingsRemoved: 40, lecturesAffected: 15 }),
    })

    fireEvent.click(await screen.findByTestId('downgrade-pro'))

    // The list is capped; the count is not, so a truncated list never reads
    // as the whole of what is at stake.
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      /and 14 more lectures/i,
    )
  })

  it('reassures when a smaller plan would delete nothing', async () => {
    renderPage({
      billing: subscribed,
      preview: impact({
        recordingsRemoved: 0,
        lecturesAffected: 0,
        lectures: [],
      }),
    })

    fireEvent.click(await screen.findByTestId('downgrade-pro'))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      /Nothing you have recorded will be deleted/i,
    )
  })

  it('changes nothing while the warning is only being read', async () => {
    const mocked = renderPage({ billing: subscribed })

    fireEvent.click(await screen.findByTestId('downgrade-pro'))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: /Cancel$/i }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(
      mocked.fetchMock.mock.calls.filter(args =>
        String(args[0]).endsWith('billing.change'),
      ),
    ).toHaveLength(0)
  })

  it('moves the account down once the warning is accepted', async () => {
    const mocked = renderPage({
      billing: subscribed,
      changed: summary({
        tier: 'pro',
        status: 'active',
        canManageBilling: true,
      }),
    })

    fireEvent.click(await screen.findByTestId('downgrade-pro'))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: /Switch to Pro/i,
      }),
    )

    // Said here rather than on a page the browser is sent to: unlike checkout,
    // this never leaves the app.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /now on the Pro plan/i,
    )
    expect(await screen.findByTestId('current-plan-pro')).toBeInTheDocument()
    const call = mocked.fetchMock.mock.calls.find(args =>
      String(args[0]).endsWith('billing.change'),
    )!
    expect(JSON.parse(String(call[1]?.body))).toEqual({ tier: 'pro' })
  })

  it('calls a move to free what it is, and says when it takes effect', async () => {
    renderPage({
      billing: subscribed,
      preview: impact({
        tier: 'free',
        nextRetentionDays: 7,
        effective: 'period_end',
        effectiveAt: '2026-09-01T00:00:00.000Z',
      }),
    })

    fireEvent.click(await screen.findByTestId('downgrade-free'))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Cancel your subscription\?/i)
    // The paid period is not forfeited, and the dialog says when it ends.
    expect(dialog).toHaveTextContent(/runs until.*2026.*then moves to Free/i)
  })

  it('hides the step-down buttons once the plan is already ending', async () => {
    renderPage({
      billing: summary({
        tier: 'max',
        status: 'active',
        canManageBilling: true,
        cancelAtPeriodEnd: true,
      }),
    })

    await screen.findByTestId('plan-table')
    // The account is on its way to free either way — there is nothing left to
    // step down from.
    expect(screen.queryByRole('button', { name: /Switch to/i })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Cancel subscription/i }),
    ).toBeNull()
  })

  it('reports a change the provider refused, and keeps the plan', async () => {
    renderPage({ billing: subscribed, changeStatus: 503 })

    fireEvent.click(await screen.findByTestId('downgrade-pro'))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: /Switch to Pro/i,
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not change your plan/i,
    )
    expect(await screen.findByTestId('current-plan-max')).toBeInTheDocument()
  })

  it('reports a preview it could not read, and opens no dialog', async () => {
    const mocked = mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user, accessToken: 't' },
      }),
      '/api/actions/billing.plans': () => ({ status: 200, body: catalog() }),
      '/api/actions/billing.summary': () => ({ status: 200, body: subscribed }),
      '/api/actions/billing.changePreview': () => ({
        status: 503,
        body: { error: { code: 'billing_unavailable', message: 'busy' } },
      }),
    })
    setAccessToken('t')
    render(
      <MemoryRouter initialEntries={['/app/plans']}>
        <AuthProvider>
          <PlanPricingPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByTestId('downgrade-pro'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not work out what this change would do/i,
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocked.fetchMock).toHaveBeenCalled()
  })

  it('reports a catalog it could not load', async () => {
    renderPage({ plans: null })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not load the plans/i,
    )
  })
})
