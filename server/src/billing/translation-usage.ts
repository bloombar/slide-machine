/**
 * Which translation allowance a deck translation spends, and whether it may run
 * at all (SPEC BILL-3/BILL-4, SHARE-2).
 *
 * Translated viewing shipped ahead of billing, so until now it was the one paid
 * service in the product that nobody was charged for. This is the missing half:
 * the caps and the panel already existed, the counting did not.
 *
 * It follows the narration split (`tts-usage.ts`) exactly, because the same two
 * facts are true of both — the deck's owner always pays, and work an audience
 * causes must not be able to exhaust the allowance the owner needs to prepare
 * tomorrow's lecture. What differs is only the unit each side is counted in:
 *
 *   - **An owner is charged for the words.** `translationCharacters` counts the
 *     source characters actually submitted to the provider, so a long deck costs
 *     more than a short one and re-reading a translated deck costs nothing.
 *   - **An audience is charged for the language.** `audienceLocales` counts one
 *     per deck-locale a viewer is the first to ask for, however long the deck
 *     and however many students read it afterwards. The first viewer pays for
 *     the language; everyone behind them reads the stored translation.
 *
 * Counting the audience side in whole languages rather than characters is what
 * makes the allowance legible: "your viewers may read two of your lectures in a
 * language you did not translate them into" is a sentence an instructor can act
 * on, and a character budget spent by strangers is not.
 */
import type { PlanTier, UsageMetric } from '@slide-machine/shared'
import { UserModel } from '../models/user'
import { effectivePlanTier, PLAN_FIELDS } from './plan-grant'
import { assertWithinCap, capFor, recordUsage } from './usage'

/** Whether the person who asked was preparing the deck or reading it. Editors
 * count as authors: they are doing the owner's work. */
export type TranslationActor = 'author' | 'audience'

/** Who pays for a translation, and which pool it comes out of. */
export interface TranslationBilling {
  /** The account charged — always the deck's owner, never the viewer. */
  ownerId: string
  /** The owner's effective tier, complimentary grants included (ADMIN-9). */
  tier: PlanTier
  actor: TranslationActor
}

/** The metric a translation is charged to. */
export const translationMetricFor = (actor: TranslationActor): UsageMetric =>
  actor === 'audience' ? 'audienceLocales' : 'translationCharacters'

/**
 * Resolves who pays for a deck's translation, or `undefined` when the owner's
 * account no longer exists.
 *
 * An ownerless deck is billable to nobody: there is no allowance to check and
 * no counter to debit, so the translation proceeds unmetered rather than
 * failing. The same call the narration path makes, for the same reason.
 */
export const translationBillingFor = async (
  ownerId: string,
  actor: TranslationActor,
): Promise<TranslationBilling | undefined> => {
  const owner = await UserModel.findById(ownerId)
    .select(PLAN_FIELDS)
    .catch(() => null)
  if (!owner) return undefined
  return { ownerId, tier: effectivePlanTier(owner), actor }
}

/**
 * The message shown when the allowance blocks the work.
 *
 * A viewer is told only that the lecture is not readable in that language
 * (BILL-4): they may be anonymous, the limit is not theirs to fix, and the
 * instructor's billing state is none of their business. A cap of `0` is a
 * capability the tier never had rather than an allowance that ran out, so it
 * says so instead of claiming the owner spent something they never had.
 */
const messageFor = (tier: PlanTier, actor: TranslationActor): string => {
  if (actor === 'audience') {
    return 'This lecture isn’t available in that language.'
  }
  return capFor(tier, 'translationCharacters') === 0
    ? 'Translation is not included in your current plan.'
    : 'You have used all of this billing period’s translation. It resets at the start of your next period.'
}

/**
 * Refuses a translation the owner can no longer afford, before anything is sent
 * to the provider. Throws `PlanLimitExceededError` (→ 402); returns normally
 * when the work may proceed.
 *
 * Call this only when there is genuinely something to translate. A deck already
 * cached in the requested language must keep opening after the cap is reached,
 * or students would lose access to a translation their instructor already paid
 * for — the same rule that keeps synthesized narration playing (BILL-4).
 *
 * `localeIsNew` is why the audience side takes a parameter the authoring side
 * does not. What that allowance sells is **languages**, so it may only ever
 * refuse a language: a student who arrives after an edit and re-translates a
 * lecture already published in their language is charged nothing, and a check
 * that blocked them would be refusing work it had no intention of billing for.
 * The exposure this leaves — free re-translation of an edited deck — is bounded
 * by how often the owner edits a deck their audience is already reading, and is
 * the price of an allowance an instructor can understand.
 */
export const assertTranslationCapacity = async (
  billing: TranslationBilling,
  { localeIsNew }: { localeIsNew: boolean },
): Promise<void> => {
  if (billing.actor === 'audience' && !localeIsNew) return
  await assertWithinCap(
    billing.ownerId,
    billing.tier,
    translationMetricFor(billing.actor),
    messageFor(billing.tier, billing.actor),
  )
}

/**
 * Records a translation that reached the provider.
 *
 * `characters` is what was submitted, markup included, because that is what the
 * vendor bills for — the caps were sized in the same units (BILLING_COST_MODEL).
 * `localeIsNew` says whether this call created the deck's entry for that
 * language, which is the whole of what the audience side counts.
 *
 * An audience request against a language that already existed therefore records
 * nothing billable even though it re-translated edited slides. That is the
 * promise the allowance makes — one unit per language, not per read — and the
 * exposure it buys is bounded by how often the owner edits a deck that is
 * already being read in translation.
 */
export const recordTranslationUsage = async (
  billing: TranslationBilling,
  { characters, localeIsNew }: { characters: number; localeIsNew: boolean },
): Promise<void> => {
  if (billing.actor === 'audience') {
    await recordUsage(billing.ownerId, 'audienceLocales', localeIsNew ? 1 : 0, {
      billable: localeIsNew,
    })
    return
  }
  await recordUsage(billing.ownerId, 'translationCharacters', characters)
}

/**
 * Records a translation served entirely from the cache: counted, never debited
 * (BILL-3).
 *
 * Reading a stored translation costs nothing, so it must not spend an
 * allowance — but it still happened, and the number of students who read a deck
 * in their own language is the denominator of every per-student average
 * BILL-7 reports. A cache hit that went unrecorded would make a deck read by
 * thirty students look like a deck read by the two who arrived first.
 */
export const recordCachedTranslation = async (
  billing: TranslationBilling,
): Promise<void> => {
  await recordUsage(billing.ownerId, translationMetricFor(billing.actor), 0, {
    billable: false,
  })
}
