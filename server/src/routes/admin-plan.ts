/**
 * Complimentary plan grants (ADMIN-9): the two audited endpoints an admin
 * uses to put an account on a larger plan without charging for it, and to end
 * that early. Mounted inside adminRouter (routes/admin.ts) after requireAuth +
 * requireAdmin, so the allowlist gate covers them too.
 *
 * These sit apart from the account settings editor (routes/admin-settings.ts),
 * which deliberately rejects any patch naming `planTier`: what a plan costs
 * and what it allows is billing state (§5), not a profile setting, and it does
 * not belong in the settings change log with someone's bio. It is audited as
 * an admin action instead, like a password reset or a ban.
 *
 * Nothing here writes `planTier`. The grant is a record beside it with an
 * expiry, and entitlement is computed from the pair — see
 * billing/plan-grant.ts for why that, rather than a swap-and-restore, is what
 * makes "revert to whatever they had before" land on the truth.
 *
 * Neither endpoint refuses an allowlisted target the way the moderation ones
 * do (ADMIN-1). "Admins are not moderated" protects an operator from being
 * locked out of their own console; a grant is the opposite kind of act — it
 * only ever hands something over, expires on its own, and costs nothing — and
 * an admin running a pilot on their own account had no way to do it. What
 * keeps that honest is the audit trail rather than a refusal: every grant
 * records whether its target is an admin and whether it is the actor's own
 * account (ADMIN-7).
 */
import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { planRank, PLAN_TIERS } from '@slide-machine/shared'
import { logAdminAction } from '../audit/log'
import { grantInEffect } from '../billing/plan-grant'
import { isAdminEmail } from '../config/admin'
import { HttpError } from '../middleware/error'
import { actor, loadUser } from './admin-targets'

export const adminPlanRouter = Router()

/**
 * A bare `YYYY-MM-DD` — what an `<input type="date">` submits. Read as the
 * **end** of that day rather than its first instant, so "expires on the 30th"
 * includes the 30th; anything else is parsed as the instant it states.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** The instant a submitted expiry means, or null if it is not a date. */
const parseExpiry = (value: string): Date | null => {
  const iso = DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

const grantSchema = z.strictObject({
  tier: z.enum(PLAN_TIERS),
  expiresAt: z.string().trim().min(1, 'An expiry date is required'),
  // For the audit trail only — the account is never shown why.
  note: z.string().trim().max(500).optional(),
})

adminPlanRouter.put('/users/:id/plan-grant', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)

  const parsed = grantSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      'Invalid plan grant',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    )
  }
  const { tier, note } = parsed.data

  const expiresAt = parseExpiry(parsed.data.expiresAt)
  if (!expiresAt) {
    throw new HttpError(400, 'invalid_input', 'Expiry is not a date')
  }
  // A grant with no future in it would be a no-op that still wrote an audit
  // entry saying an account had been upgraded.
  if (expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, 'invalid_input', 'Expiry must be in the future')
  }
  // A grant only ever raises (billing/plan-grant.ts). Accepting one at or
  // below the account's own tier would store something that changes nothing,
  // and reporting it as a grant would be a lie of omission.
  if (planRank(tier) <= planRank(user.planTier)) {
    throw new HttpError(
      400,
      'not_an_upgrade',
      `This account is already on ${user.planTier}; a grant can only move it to a larger plan`,
    )
  }

  const previous = user.planGrant
  user.planGrant = {
    tier,
    expiresAt,
    grantedAt: new Date(),
    grantedBy: new Types.ObjectId(admin.id),
    grantedByEmail: admin.email,
    note,
  }
  await user.save()

  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.plan_grant',
    targetType: 'user',
    targetId: user._id.toString(),
    details: {
      email: user.email,
      tier,
      expiresAt: expiresAt.toISOString(),
      // What it falls back to, so the log says what was given *and* what the
      // account is actually paying for underneath it.
      revertsTo: user.planTier,
      note,
      // An allowlisted target — the acting admin's own account included — is
      // allowed here, unlike moderation, so the log is what makes it visible.
      // Recorded on every grant rather than only on the self-dealing ones: a
      // flag that appears only when true is a flag a reader has to know to
      // look for.
      targetIsAdmin: isAdminEmail(user.email),
      self: user._id.toString() === admin.id,
      replaced: previous
        ? { tier: previous.tier, expiresAt: previous.expiresAt.toISOString() }
        : undefined,
    },
  })
  res.status(204).end()
})

/**
 * Ends a grant now rather than waiting for it to lapse. The account drops to
 * whatever its own billing entitles it to, immediately — the same landing
 * place expiry would have reached, just sooner.
 *
 * Idempotent: an account with nothing in effect is already where this would
 * put it, so it answers 204 without writing an audit entry for a change that
 * did not happen. A lapsed record is cleared too, so revoking always leaves
 * the account with no grant at all.
 *
 * Nothing about an allowlisted target changes here either: revoking only ever
 * takes privilege away, so refusing it could only strand a grant.
 */
adminPlanRouter.delete('/users/:id/plan-grant', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)

  const grant = user.planGrant
  if (!grant) {
    res.status(204).end()
    return
  }
  const wasInEffect = Boolean(grantInEffect(user))
  user.planGrant = undefined
  await user.save()

  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.plan_grant_revoke',
    targetType: 'user',
    targetId: user._id.toString(),
    details: {
      email: user.email,
      tier: grant.tier,
      expiresAt: grant.expiresAt.toISOString(),
      // A lapsed grant being cleared is tidying, not a downgrade; the log
      // distinguishes the two so a reader knows whether anything changed.
      wasInEffect,
      revertedTo: user.planTier,
    },
  })
  res.status(204).end()
})
