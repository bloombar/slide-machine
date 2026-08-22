/**
 * One account's metered usage, for the admin console: reading it (BILL-4's
 * summary through the allowlist gate rather than the self-only `user.usage`
 * action, which deliberately takes no target) and resetting it (ADMIN-10).
 *
 * Mounted inside adminRouter (routes/admin.ts) after requireAuth +
 * requireAdmin, so the allowlist gate covers both.
 *
 * A reset gives an allowance back; it does not rewrite what an account
 * consumed. The counters for the current period go to zero, every earlier
 * period stands, and the cost ledger (BILL-7) — which is what the deployment
 * actually spent — is never touched. So an operator who comps a department a
 * fresh month can still answer "what did this cost us" afterwards.
 */
import { Router } from 'express'
import type {
  AdminUsageResetResponse,
  UsageMetric,
  UsageSummaryResponse,
} from '@slide-machine/shared'
import { logAdminAction } from '../audit/log'
import { effectivePlanTier } from '../billing/plan-grant'
import { resetPeriodUsage } from '../billing/usage'
import { accountUsage } from '../billing/usage-view'
import { isAdminEmail } from '../config/admin'
import { HttpError } from '../middleware/error'
import { actor, loadAnyUser, loadUser } from './admin-targets'

export const adminUsageRouter = Router()

/**
 * One account's usage against its caps. `?window=all` totals every period
 * instead of the current one. Opens a soft-deleted account too (ADMIN-6):
 * what a tombstoned account spent is exactly the kind of thing an operator
 * still has to be able to look up.
 */
adminUsageRouter.get('/users/:id/usage', async (req, res) => {
  const window = req.query.window ?? 'period'
  if (window !== 'period' && window !== 'all') {
    throw new HttpError(400, 'invalid_input', 'Invalid usage window')
  }
  const user = await loadAnyUser(String(req.params.id))
  const body: UsageSummaryResponse = await accountUsage(
    user._id.toString(),
    effectivePlanTier(user),
    window,
  )
  res.json(body)
})

/**
 * Gives the account its allowances back for the billing period it is in
 * (ADMIN-10) — the fix for a bad generation run, a botched import, or a
 * lecture whose audience spent a term's budget in an afternoon.
 *
 * Deliberately not a plan grant (ADMIN-9): a grant raises what an account is
 * *entitled* to for a stretch of time, while this returns what it has already
 * *spent* this period without changing its plan at all. An operator making
 * good on one bad afternoon should not have to leave a comped tier behind to
 * expire later.
 *
 * `loadUser` rather than `loadAnyUser`: a deleted account is restored, not
 * adjusted, and its counters mean nothing until it is.
 *
 * Allowed against an allowlisted account, like a plan grant and unlike
 * moderation: this hands an allowance to whoever the target is, so refusing it
 * would only strand an admin's own account with no way back under a cap. The
 * audit entry names the target as an admin so the log shows plainly when an
 * operator has done it to themselves.
 */
adminUsageRouter.post('/users/:id/usage/reset', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)

  const { period, cleared } = await resetPeriodUsage(user._id.toString())

  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.usage_reset',
    targetType: 'user',
    targetId: user._id.toString(),
    details: {
      email: user.email,
      period,
      // What each counter stood at, so the log records what was given back
      // rather than only that something was.
      cleared,
      targetIsAdmin: isAdminEmail(user.email),
      self: user._id.toString() === admin.id,
    },
  })

  const body: AdminUsageResetResponse = {
    period,
    cleared: cleared as Partial<Record<UsageMetric, number>>,
  }
  res.json(body)
})
