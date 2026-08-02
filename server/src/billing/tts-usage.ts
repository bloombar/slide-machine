/**
 * Which narration allowance a synthesis spends, and whether it may run at all
 * (SPEC BILL-1/BILL-3/BILL-4).
 *
 * Three rules, all of which follow from "the deck owner always pays":
 *
 * 1. **Who triggered it picks the pool.** An owner or editor preparing a
 *    lecture draws on the authoring allowance; anyone else listening draws on
 *    the separate audience allowance, so a deck that finds an audience can
 *    never stop its author from preparing tomorrow's lecture.
 * 2. **The voice picks the rate, but only for authoring.** Premium voices cost
 *    roughly twice standard ones and have their own cap, which is how a tier
 *    gates them. There is deliberately no audience-premium metric: the audience
 *    pool is sized in characters, and premium is a capability the *owner* opts
 *    into — so viewer-triggered premium work spends the audience pool while
 *    still requiring the owner's tier to include premium at all.
 * 3. **Messages are read by whoever was blocked.** A viewer learns the audio
 *    is not available; they never learn anything about the owner's billing.
 *
 * Every plan offers every voice; a cheaper tier simply gets fewer premium
 * characters (BILL-1). So premium is a rate, not a gate — the same decision
 * taken for cloud transcription, and for the same reason: a capability that
 * appears and disappears with the plan is harder to explain than an allowance
 * that runs out.
 */
import type { PlanTier, UsageMetric } from '@slide-machine/shared'
import { assertWithinCap, capFor } from './usage'

/** Whether the person who triggered synthesis was preparing the deck or
 * listening to it. Editors count as authors: they are doing the same work. */
export type TtsActor = 'author' | 'audience'

/** The metric a synthesis is charged to. */
export const ttsMetricFor = (actor: TtsActor, premium: boolean): UsageMetric =>
  actor === 'audience'
    ? 'audienceTtsCharacters'
    : premium
      ? 'ttsPremiumCharacters'
      : 'ttsCharacters'

/**
 * The message shown when `metric` blocks the work. A cap of `0` is not an
 * exhausted allowance but a capability the tier never had, so it says so rather
 * than claiming the user spent something they never had.
 */
const messageFor = (
  tier: PlanTier,
  metric: UsageMetric,
  actor: TtsActor,
): string => {
  if (actor === 'audience') {
    return 'Narration isn’t available for this slide yet.'
  }
  const excluded = capFor(tier, metric) === 0
  if (metric === 'ttsPremiumCharacters') {
    // Not the excluded case: a tier without premium is given the standard voice
    // rather than an error, so reaching here means the allowance ran out.
    return 'You have used all of this billing period’s premium narration. It resets at the start of your next period.'
  }
  return excluded
    ? 'Narration is not included in your current plan.'
    : 'You have used all of this billing period’s narration. It resets at the start of your next period.'
}

/**
 * Refuses synthesis the owner can no longer afford, before anything is sent to
 * the synthesizer. Throws `PlanLimitExceededError` (→ 402); returns normally
 * when the work may proceed.
 *
 * Call this only on a cache miss. Serving audio that already exists costs
 * nothing and must keep working after a cap is reached, or students would lose
 * access to material their instructor already paid to produce.
 */
export const assertTtsCapacity = async (
  ownerId: string,
  tier: PlanTier,
  actor: TtsActor,
  premium: boolean,
): Promise<void> => {
  const metric = ttsMetricFor(actor, premium)
  await assertWithinCap(ownerId, tier, metric, messageFor(tier, metric, actor))
  // Premium is the owner's capability wherever the characters come from, so an
  // audience request for a premium voice is checked against it as well —
  // checked, not charged: the audience pool is what actually pays.
  if (premium && actor === 'audience') {
    await assertWithinCap(
      ownerId,
      tier,
      'ttsPremiumCharacters',
      messageFor(tier, 'ttsPremiumCharacters', actor),
    )
  }
}
