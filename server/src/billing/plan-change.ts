/**
 * Moving an account between tiers (SPEC BILL-5), and what that costs it.
 *
 * Upgrades are a purchase and go through hosted checkout. Moving *down* is
 * different: the account already has a subscription, so there is nothing to
 * buy — and a smaller plan keeps lecture audio for fewer days, which can put
 * recordings the user still has past the new limit. The retention sweep would
 * then delete them (P-6), so the user has to be told what will go **before**
 * they confirm (P-10) rather than discover it a day later.
 *
 * That warning is the reason the change is driven from here rather than handed
 * to the provider's hosted portal: a page we do not render cannot list the
 * lectures that are about to lose their recordings, and a warning shown before
 * a redirect describes a choice the user has not made yet.
 *
 * Two shapes of change, because "no plan" is not a plan you can buy:
 *
 * - **Paid → paid** takes effect immediately, with the provider prorating the
 *   part of the period already paid for.
 * - **Paid → free** is a cancellation, and runs to the end of the period the
 *   user has already paid for. Nothing is deleted before then, since the tier
 *   — and so the retention window — does not change until it lapses.
 */
import type {
  PlanChangeImpact,
  PlanChangeLecture,
  PlanTier,
} from '@slide-machine/shared'
import { PLAN_TIERS } from '@slide-machine/shared'
import { env } from '../config/env'
import { loadPlans } from '../config/plans'
import { DeckModel } from '../models/deck'
import { SubscriptionModel } from '../models/subscription'
import { effectiveRetentionDays } from '../jobs/audio-cleanup'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How many lectures the warning names. A user with hundreds of affected
 * lectures needs the count and a sample, not a list no one will read; the
 * count is always exact.
 */
export const NAMED_LECTURE_LIMIT = 12

/** Whether `tier` sits below `current`; PLAN_TIERS runs cheapest to largest. */
export const isDowngrade = (tier: PlanTier, current: PlanTier): boolean =>
  PLAN_TIERS.indexOf(tier) < PLAN_TIERS.indexOf(current)

/**
 * The retention window that actually applies on `tier`, in days, or null when
 * nothing expires on time — the deployment's sweep is off (`0`), which is its
 * blanket "keep everything", and no tier can tighten what is not running.
 */
export const retentionWindowFor = (tier: PlanTier): number | null => {
  const deploymentDays = env.AUDIO_RETENTION_DAYS
  if (deploymentDays <= 0) return null
  const plan = loadPlans()[tier]
  return effectiveRetentionDays(
    plan?.audioRetentionDays ?? null,
    deploymentDays,
  )
}

/**
 * Recordings that would fall outside `days`, grouped by the lecture holding
 * them. Only the owner's own lectures are looked at: retention follows the
 * lecture owner's plan (P-6), so a deck shared with them is not theirs to lose.
 */
const recordingsPast = async (
  userId: string,
  days: number,
  now: number,
): Promise<{
  total: number
  affected: number
  lectures: PlanChangeLecture[]
}> => {
  const cutoff = new Date(now - days * DAY_MS)
  const decks = await DeckModel.find({
    ownerId: userId,
    'recordings.createdAt': { $lt: cutoff },
  }).select('title recordings')

  let total = 0
  const lectures: PlanChangeLecture[] = []
  for (const deck of decks) {
    const count = (deck.recordings ?? []).filter(
      rec => rec.createdAt < cutoff,
    ).length
    if (!count) continue
    total += count
    lectures.push({
      deckId: deck._id.toString(),
      title: deck.title,
      recordings: count,
    })
  }
  // Most-affected first, so a truncated list is the part worth reading.
  lectures.sort((a, b) => b.recordings - a.recordings)
  return {
    total,
    affected: lectures.length,
    lectures: lectures.slice(0, NAMED_LECTURE_LIMIT),
  }
}

/**
 * What moving `userId` from `currentTier` to `tier` would do — the answer the
 * confirmation dialog is built from (BILL-5).
 *
 * A move that does not tighten retention reports no losses rather than
 * scanning for them: an upgrade, a deployment whose sweep is off, or a tier
 * whose window is already the deployment's.
 */
export const planChangeImpact = async (
  userId: string,
  currentTier: PlanTier,
  tier: PlanTier,
  now: number = Date.now(),
): Promise<PlanChangeImpact> => {
  const sub = await SubscriptionModel.findOne({ userId })
  const hasSubscription = Boolean(
    sub?.providerSubscriptionId && sub.status !== 'canceled',
  )
  const down = isDowngrade(tier, currentTier)

  const currentRetentionDays = retentionWindowFor(currentTier)
  const nextRetentionDays = retentionWindowFor(tier)
  const tightens =
    nextRetentionDays !== null &&
    (currentRetentionDays === null || nextRetentionDays < currentRetentionDays)

  const { total, affected, lectures } = tightens
    ? await recordingsPast(userId, nextRetentionDays, now)
    : { total: 0, affected: 0, lectures: [] as PlanChangeLecture[] }

  // Cancelling runs to the end of the paid period; a switch between paid tiers
  // is immediate. Either way the date comes from the subscription rather than
  // being computed here — the provider owns when the period ends.
  const cancels = tier === 'free'
  return {
    tier,
    currentTier,
    isDowngrade: down,
    currentRetentionDays,
    nextRetentionDays,
    recordingsRemoved: total,
    lecturesAffected: affected,
    lectures,
    effective: cancels ? 'period_end' : 'immediately',
    effectiveAt: cancels
      ? (sub?.currentPeriodEnd?.toISOString() ?? null)
      : null,
    changeable: hasSubscription && down && tier !== currentTier,
  }
}
