/**
 * Plan and billing in account settings (SPEC BILL-2): what the account is on,
 * what happens at the end of the period, and the hosted portal for payment
 * methods, invoices, and cancellation.
 *
 * Choosing a *different* plan is not here. Comparing four plans needs a table,
 * and a table needs a page — so settings links to the plan-pricing page, which
 * owns the upgrade buttons, and this panel keeps only what is true of the
 * subscription the account already has.
 *
 * The portal is a redirect. The app never collects card details and never
 * quotes a price: the provider hosts those pages and is the system of record
 * for what was charged (P-8), so this component only ever navigates.
 *
 * Coming back from checkout is deliberately not treated as proof of anything.
 * The plan changes when the provider's webhook says it did, which may land a
 * second after the browser does — so a completed checkout shows "updating"
 * and re-reads the summary, rather than asserting a tier the server has not
 * agreed to yet.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import type { BillingSummary } from '@slide-machine/shared'
import { fetchBillingSummary, openBillingPortal } from '../api/billing'
import { apiErrorMessage } from '../i18n/apiError'
import { formatDate } from '../i18n/format'
import { useAuth } from '../auth/AuthContext'
import { callToActionFor } from '../lib/usage'

/** How long to wait before re-reading the summary after checkout returns.
 * One retry, not a poll: the webhook is normally already applied, and a page
 * that keeps refetching is worse than one that settles a moment late. */
const WEBHOOK_GRACE_MS = 2500

export default function BillingPanel() {
  const { t } = useTranslation()
  const { user, updateUser } = useAuth()
  const [searchParams] = useSearchParams()
  const outcome = searchParams.get('checkout')

  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which button is mid-redirect, so it can be disabled by name. */
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const body = await fetchBillingSummary()
    setSummary(body)
    // The tier lives on the account everywhere else in the app; a plan that
    // changed while this page was open would otherwise leave the header and
    // the usage bars quoting the old one until the next sign-in.
    if (user && body.tier !== user.planTier) {
      updateUser({ ...user, planTier: body.tier })
    }
  }, [user, updateUser])

  useEffect(() => {
    let live = true
    fetchBillingSummary()
      .then(body => live && setSummary(body))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  // A completed checkout races the provider's webhook, so read again once the
  // grace period is up rather than showing a plan that is about to change.
  useEffect(() => {
    if (outcome !== 'success') return
    const timer = setTimeout(
      () => void load().catch(() => undefined),
      WEBHOOK_GRACE_MS,
    )
    return () => clearTimeout(timer)
  }, [outcome, load])

  /** Runs a redirect-producing call, leaving the button disabled: the page is
   * on its way out, so re-enabling it would only invite a second checkout. */
  const redirect = async (
    key: string,
    call: () => Promise<{ url: string }>,
  ) => {
    setBusy(key)
    setError(null)
    try {
      const { url } = await call()
      window.location.assign(url)
    } catch (err) {
      setError(apiErrorMessage(err, t, 'billing.errors.redirect'))
      setBusy(null)
    }
  }

  if (failed) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {t('billing.errors.load')}
      </p>
    )
  }
  if (!summary) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }

  const renewalKey = summary.cancelAtPeriodEnd ? 'endsOn' : 'renewsOn'

  return (
    <section data-testid="billing-panel" className="flex flex-col gap-4">
      {outcome === 'success' && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {t('billing.checkout.success')}
        </p>
      )}
      {outcome === 'canceled' && (
        <p
          role="status"
          className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          {t('billing.checkout.canceled')}
        </p>
      )}

      <div className="text-sm text-slate-600">
        {summary.status === null && <p>{t('billing.status.none')}</p>}
        {summary.status === 'past_due' && (
          <p role="alert" className="font-medium text-amber-700">
            {t('billing.status.pastDue')}
          </p>
        )}
        {summary.status === 'canceled' && <p>{t('billing.status.canceled')}</p>}
        {summary.currentPeriodEnd && summary.status !== 'canceled' && (
          <p>
            {t(`billing.${renewalKey}`, {
              date: formatDate(summary.currentPeriodEnd, 'long'),
            })}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Only once the provider has something on file to manage — before that
          there are no invoices, no card, and nothing to cancel. */}
      {summary.canManageBilling && (
        <div>
          <button
            disabled={busy !== null}
            onClick={() => void redirect('portal', () => openBillingPortal())}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {t('billing.manage')}
          </button>
        </div>
      )}

      {/* Max has no larger plan to move to, so it is invited to get in touch
          rather than shown an upgrade that does not exist (BILL-5). */}
      {callToActionFor(summary.tier) === 'contact' && (
        <p className="text-xs text-slate-500">{t('usage.cta.contact')}</p>
      )}
    </section>
  )
}
