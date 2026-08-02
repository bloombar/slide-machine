/**
 * The plan comparison (SPEC BILL-1/BILL-5): every plan as a column, every
 * capability as a row, and one button per plan to move onto it.
 *
 * A page of its own rather than a row of buttons in account settings. Choosing
 * a plan means comparing them, and a comparison needs the room to put four
 * columns beside each other; settings keeps the one question it can answer on
 * its own — what am I on now — and links here for the rest.
 *
 * The rows read top-down from "what the product does" to "how much of it you
 * may use": the unmetered capabilities first, which every plan includes
 * (BILL-1), then the allowances, which are the only thing that actually
 * differs. Retention sits between them — it is a policy rather than a meter,
 * but it does vary by plan, so it is shown where the differences start.
 *
 * Buying is the same redirect it is everywhere else: the provider hosts
 * checkout, this page only navigates (P-8), and the plan changes when the
 * webhook says so — which is why the browser is sent back to the account's
 * Plan tab, where that story is already told, rather than back here.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check } from 'lucide-react'
import {
  PLAN_FEATURES,
  PLAN_TIERS,
  type BillingSummary,
  type PlanCatalog,
  type PlanCatalogEntry,
  type PlanFeature,
  type PlanTier,
  type UsageMetric,
  type UsageUnit,
} from '@slide-machine/shared'
import {
  fetchBillingSummary,
  fetchPlanCatalog,
  openBillingPortal,
  startCheckout,
} from '../api/billing'
import { apiErrorMessage } from '../i18n/apiError'
import { formatCurrencyMinor } from '../i18n/format'
import { callToActionFor, formatAmount, friendlyCap } from '../lib/usage'

/** Where the account's own plan lives — where this page is reached from, and
 * where checkout returns to. */
const PLAN_TAB = '/app/settings?tab=plan'

/** Whether `tier` is above `current`; PLAN_TIERS runs cheapest to largest. */
const isAbove = (tier: PlanTier, current: PlanTier): boolean =>
  PLAN_TIERS.indexOf(tier) > PLAN_TIERS.indexOf(current)

/** The two allowances, named rather than written inline: the metered rows are
 * split by one of these, and a bare string in the JSX below reads to the i18n
 * lint as an untranslated label. */
const ALLOWANCE = { instructor: 'instructor', audience: 'audience' } as const

const cellClass = 'px-4 py-3 text-center text-sm text-slate-700'
const rowHeaderClass =
  'px-4 py-3 text-left text-sm font-normal text-slate-700 sm:w-64'

export default function PlanPricingPage() {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<PlanCatalog | null>(null)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which button is mid-redirect, so every button can be disabled while the
   * page is on its way out. */
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchPlanCatalog(), fetchBillingSummary()])
      .then(([plans, billing]) => {
        if (!live) return
        setCatalog(plans)
        setSummary(billing)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  /** Runs a redirect-producing call, leaving the buttons disabled: the page is
   * on its way out, so re-enabling them would only invite a second checkout. */
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
        {t('plan.pricing.errors.load')}
      </p>
    )
  }
  if (!catalog || !summary) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }

  const { plans, metrics } = catalog
  const current = summary.tier
  const tierName = (tier: PlanTier) =>
    t(`plan.tier.${tier}`, { defaultValue: tier })

  /**
   * What a plan costs, over how long — "$29.00 per month", or every third
   * month where the provider bills that way. A plan the provider quoted no
   * price for shows nothing rather than a zero it would not charge; only the
   * free tier, which has no price to quote, says so in words.
   */
  const priceLine = (plan: PlanCatalogEntry) => {
    if (!plan.price) {
      return plan.purchasable ? null : (
        <span className="text-sm font-medium text-slate-600">
          {t('plan.pricing.free')}
        </span>
      )
    }
    const { amountMinor, currency, interval, intervalCount } = plan.price
    return (
      <span className="text-sm font-medium text-slate-600">
        {t(`plan.pricing.per.${interval}`, {
          price: formatCurrencyMinor(amountMinor, currency),
          count: intervalCount,
        })}
      </span>
    )
  }

  /**
   * An allowance as the table states it: "unlimited" where there is no bound,
   * "not included" for the `0` sentinel — which no shipped plan uses, but which
   * must not read as "none left" (BILL-3) — and otherwise the number.
   *
   * Where the billed unit is not one anyone thinks in, the everyday form is
   * shown instead: narration is metered in characters and read in minutes.
   */
  const capLabel = (
    metric: UsageMetric,
    cap: number | null,
    unit: UsageUnit,
  ): string => {
    if (cap === null) return t('plan.pricing.unlimited')
    if (cap === 0) return t('plan.pricing.notIncluded')
    return friendlyCap(metric, cap, t) ?? formatAmount(cap, unit, t)
  }

  /** A tick for an included capability, a dash for one that is not. Both are
   * given words, so the table reads the same to a screen reader. */
  const featureCell = (plan: PlanCatalogEntry, feature: PlanFeature) =>
    plan.features.includes(feature) ? (
      <>
        <Check className="mx-auto h-4 w-4 text-emerald-600" aria-hidden />
        <span className="sr-only">{t('plan.pricing.included')}</span>
      </>
    ) : (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">{t('plan.pricing.notIncluded')}</span>
      </>
    )

  /** The one control per column: what you are on, what it would cost to move
   * up, or nothing — a smaller plan is a downgrade, which BILL-5 routes
   * through the hosted portal rather than a second checkout. */
  const action = (plan: PlanCatalogEntry) => {
    if (plan.tier === current) {
      return (
        <span
          data-testid={`current-plan-${plan.tier}`}
          className="inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
        >
          {t('plan.pricing.currentPlan')}
        </span>
      )
    }
    if (isAbove(plan.tier, current) && plan.purchasable) {
      return (
        <button
          disabled={busy !== null}
          onClick={() =>
            void redirect(plan.tier, () => startCheckout(plan.tier, PLAN_TAB))
          }
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {t('billing.upgradeTo', { plan: tierName(plan.tier) })}
        </button>
      )
    }
    return null
  }

  /**
   * A titled band of rows. `<tbody>` per group so the heading belongs to the
   * rows under it rather than floating as another data row.
   *
   * `hint` is what is true of every row in the band — the audience pool being
   * separate from the instructor's own, say. It runs the full width directly
   * under the heading, because a caption at the foot of the table is a
   * sentence with nothing visibly attached to it.
   */
  const group = (title: string, rows: ReactNode, hint?: string) => (
    <tbody className="divide-y divide-slate-100 border-t border-slate-200">
      <tr className="bg-slate-50">
        <th
          scope="colgroup"
          colSpan={plans.length + 1}
          className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
        >
          {title}
        </th>
      </tr>
      {hint && (
        <tr className="bg-slate-50">
          <td
            colSpan={plans.length + 1}
            className="px-4 pb-2 text-left text-xs text-slate-500"
          >
            {hint}
          </td>
        </tr>
      )}
      {rows}
    </tbody>
  )

  /** A row's name and, under it, what the allowance actually covers. The hints
   * are why the table can be read without a support page: an allowance that is
   * smaller than the one above it — diarizing fewer minutes than you may record
   * — is a deliberate limit, and has to say so. */
  const rowHeader = (label: string, hint: string) => (
    <th scope="row" className={rowHeaderClass}>
      <span className="block">{label}</span>
      <span className="mt-0.5 block text-xs font-normal text-slate-500">
        {hint}
      </span>
    </th>
  )

  /** How long recordings are kept. A policy rather than a meter, but it is the
   * companion to the recording allowance — how much you may record, then how
   * long what you recorded survives — so it is shown directly beneath it. */
  const retentionRow = (
    <tr key="audioRetention">
      {rowHeader(
        t('plan.pricing.audioRetention'),
        t('plan.metricHint.audioRetention'),
      )}
      {plans.map(plan => (
        <td key={plan.tier} className={cellClass}>
          {plan.audioRetentionDays === null
            ? t('plan.pricing.retentionUnlimited')
            : t('plan.pricing.retentionDays', {
                count: plan.audioRetentionDays,
              })}
        </td>
      ))}
    </tr>
  )

  const capRows = (allowance: 'instructor' | 'audience') => {
    const rows = metrics
      .filter(row => row.allowance === allowance)
      .map(row => (
        <tr key={row.metric}>
          {rowHeader(
            t(`usage.metric.${row.metric}`, { defaultValue: row.metric }),
            t(`plan.metricHint.${row.metric}`, { defaultValue: '' }),
          )}
          {plans.map(plan => (
            <td key={plan.tier} className={cellClass}>
              {capLabel(row.metric, plan.caps[row.metric] ?? null, row.unit)}
            </td>
          ))}
        </tr>
      ))

    // Retention belongs to recorded audio, so it follows the recording
    // allowance; if a deployment meters no recording, it goes last rather
    // than disappearing.
    if (allowance !== ALLOWANCE.instructor) return rows
    const after = metrics
      .filter(row => row.allowance === allowance)
      .findIndex(row => row.metric === 'sttMinutes')
    const at = after === -1 ? rows.length : after + 1
    return [...rows.slice(0, at), retentionRow, ...rows.slice(at)]
  }

  return (
    <div>
      <Link
        to={PLAN_TAB}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('plan.pricing.back')}
      </Link>

      <h1 className="mt-3 text-2xl font-bold">{t('plan.pricing.title')}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {t('plan.pricing.subtitle')}
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* The table scrolls on its own where four columns will not fit, rather
          than making the whole page scroll sideways. */}
      <div className="mt-6 overflow-x-auto">
        <table
          data-testid="plan-table"
          className="min-w-full border-separate border-spacing-0"
        >
          <caption className="sr-only">
            {t('plan.pricing.tableCaption')}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm">
                <span className="sr-only">
                  {t('plan.pricing.featureColumn')}
                </span>
              </th>
              {plans.map(plan => (
                <th
                  key={plan.tier}
                  scope="col"
                  className={`px-4 py-3 text-center ${
                    plan.tier === current ? 'bg-indigo-50/50' : ''
                  }`}
                >
                  <div className="text-base font-semibold text-slate-900">
                    {tierName(plan.tier)}
                  </div>
                  <div className="mt-1">{priceLine(plan)}</div>
                  <div className="mt-2">{action(plan)}</div>
                </th>
              ))}
            </tr>
          </thead>

          {group(
            t('plan.pricing.features'),
            <>
              {PLAN_FEATURES.map(feature => (
                <tr key={feature}>
                  <th scope="row" className={rowHeaderClass}>
                    {t(`plan.feature.${feature}`, { defaultValue: feature })}
                  </th>
                  {plans.map(plan => (
                    <td key={plan.tier} className={cellClass}>
                      {featureCell(plan, feature)}
                    </td>
                  ))}
                </tr>
              ))}
            </>,
          )}

          {group(t('usage.instructor'), capRows(ALLOWANCE.instructor))}
          {group(
            t('usage.audience'),
            capRows(ALLOWANCE.audience),
            t('usage.audienceHint'),
          )}
        </table>
      </div>

      {/* Moving down a plan, or off one, is the hosted portal's job (BILL-5) —
          and it only exists once the account has been billed at all. */}
      {summary.canManageBilling && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            disabled={busy !== null}
            onClick={() =>
              void redirect('portal', () => openBillingPortal(PLAN_TAB))
            }
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {t('billing.manage')}
          </button>
          <p className="text-xs text-slate-500">
            {t('plan.pricing.changeHint')}
          </p>
        </div>
      )}

      {/* Max has no larger plan to move to, so it is invited to get in touch
          rather than shown an upgrade that does not exist (BILL-5). */}
      {callToActionFor(current) === 'contact' && (
        <p className="mt-4 text-xs text-slate-500">{t('usage.cta.contact')}</p>
      )}
    </div>
  )
}
