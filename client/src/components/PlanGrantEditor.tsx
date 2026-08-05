/**
 * Complimentary plan grants (SPEC ADMIN-9), on the Plan tab of the account
 * settings page an admin has opened for someone else. An admin picks a larger
 * plan and a date; the account gets it at no charge until then and returns to
 * whatever it is paying for afterwards.
 *
 * Only tiers **above** what the account already pays for are offered, because
 * only those are grants: the server refuses anything at or below it, and a
 * select that lets you choose a refusal is a select that lies. An account
 * already on the largest plan is told there is nothing to give rather than
 * shown an empty picker.
 *
 * The expiry is required — that is the whole point of a grant rather than an
 * upgrade — so the form cannot be submitted without one. A bare date travels
 * as `YYYY-MM-DD` and the server reads it as the end of that day, so the date
 * an operator picks is the last day the account keeps the plan.
 */
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  planRank,
  PLAN_TIERS,
  type AdminPlanGrant,
  type PlanTier,
} from '@slide-machine/shared'
import { grantAdminUserPlan, revokeAdminUserPlan } from '../api/admin'
import { ApiError } from '../api/http'
import { formatDate } from '../i18n/format'

const controlClass = 'rounded-md border border-slate-300 px-3 py-2 text-sm'

export default function PlanGrantEditor({
  userId,
  billingTier,
  grant,
  onChanged,
}: {
  userId: string
  /** What the account's own billing entitles it to — the floor a grant has
   * to clear, and where it lands when the grant ends. */
  billingTier: PlanTier
  /** The standing grant, if any; a lapsed one is shown as history. */
  grant?: AdminPlanGrant
  /** Re-reads the account after a change, so the page shows what landed. */
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const grantable = PLAN_TIERS.filter(
    tier => planRank(tier) > planRank(billingTier),
  )
  // Preselect what is already granted where that is still on offer — an
  // extension is the common edit — and the largest plan otherwise. A grant
  // the account has since outgrown is not among the options, so it must not
  // become a value the select cannot show.
  const [tier, setTier] = useState<PlanTier>(() => {
    const current = grant?.tier
    if (current && grantable.includes(current)) return current
    return grantable[grantable.length - 1] ?? 'max'
  })
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Runs one call, reporting its refusal rather than reverting quietly: the
   * account is not the admin's, so a control that silently snapped back would
   * leave them believing a plan had been given. */
  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await call()
      onChanged()
    } catch (err) {
      // The endpoint's refusals name the rule that was hit ("already on pro"),
      // which is worth more to an admin than a translated generic — the same
      // trade the account settings page makes (docs/I18N.md).
      setError(err instanceof ApiError ? err.message : t('plan.grant.error'))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!expiresAt) {
      setError(t('plan.grant.expiresRequired'))
      return
    }
    void run(() => grantAdminUserPlan(userId, { tier, expiresAt }))
  }

  const tierName = (value: PlanTier) =>
    t(`plan.tier.${value}`, { defaultValue: value })

  return (
    <div className="mt-6 rounded-md border border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-700">
        {t('plan.grant.title')}
      </h4>
      <p className="mt-1 text-xs text-slate-500">{t('plan.grant.hint')}</p>

      {/* What is in force now, and the way out of it. A lapsed grant stays
          visible as history — knowing an account *was* comped until last
          month is what explains its usage. */}
      {grant && (
        <p className="mt-3 text-sm text-slate-700">
          {grant.inEffect
            ? t('plan.grant.active', {
                tier: tierName(grant.tier),
                date: formatDate(grant.expiresAt),
                revertsTo: tierName(billingTier),
              })
            : t('plan.grant.ended', {
                tier: tierName(grant.tier),
                date: formatDate(grant.expiresAt),
              })}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => revokeAdminUserPlan(userId))}
            className="font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
          >
            {grant.inEffect ? t('plan.grant.end') : t('plan.grant.clear')}
          </button>
        </p>
      )}

      {grantable.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('plan.grant.maxed')}</p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="plan-grant-tier"
              className="text-xs font-medium text-slate-700"
            >
              {t('plan.grant.tier')}
            </label>
            <select
              id="plan-grant-tier"
              value={tier}
              onChange={e => setTier(e.target.value as PlanTier)}
              className={controlClass}
            >
              {grantable.map(value => (
                <option key={value} value={value}>
                  {tierName(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="plan-grant-expires"
              className="text-xs font-medium text-slate-700"
            >
              {t('plan.grant.expires')}
            </label>
            <input
              id="plan-grant-expires"
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className={controlClass}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {grant?.inEffect ? t('plan.grant.replace') : t('plan.grant.submit')}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
