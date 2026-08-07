/**
 * Cap notifications (SPEC BILL-8): telling the account that pays for a
 * resource that it is nearly out, and again when the work has actually been
 * refused.
 *
 * A cap the user did not see coming is indistinguishable from a broken
 * feature. That is the whole justification, and it shapes the rest:
 *
 * - **The payer hears, the actor does not.** Everything is keyed to the
 *   account whose allowance was spent — the deck's owner. A viewer who
 *   triggers a block gets a viewer-safe refusal (BILL-4) and no email; they may
 *   be anonymous, and the limit is not theirs to fix.
 * - **Never on the request's clock.** Crossings are queued (`cap-queue.ts`)
 *   and flushed after the response, and a send that fails is logged rather
 *   than raised. A mail outage must not turn a blocked action into a failed
 *   one — or, worse, a successful action into an error.
 * - **One message per crossing, coalesced across metrics.** The database row
 *   is the lock (`claimNotification`), so thirty students hitting one cap
 *   produce one email; the queue's debounce then gathers the several caps one
 *   lecture can exhaust into a single message listing each.
 *
 * What this module deliberately does *not* do is drive the in-app state. That
 * is derived from the counters by the usage views, appears whether or not any
 * of this ran, and cannot be silenced — which is what keeps a mail
 * misconfiguration from also costing the user their on-screen warning.
 */
import type { Locale, PlanTier, UsageMetric } from '@slide-machine/shared'
import { AUDIENCE_METRICS, USAGE_WARN_THRESHOLD } from '@slide-machine/shared'
import { UserModel } from '../models/user'
import { claimNotification } from '../models/notification-log'
import { mailerAvailable, sendMail } from '../lib/mailer'
import { capMessages } from '../i18n/cap-messages'
import { env } from '../config/env'
import { effectivePlanTier, PLAN_FIELDS } from './plan-grant'
import {
  takePending,
  type CapSignal,
  type NotificationThreshold,
} from './cap-queue'
import {
  capFor,
  isGaugeMetric,
  periodKeyFor,
  periodResetAt,
  usedThisPeriod,
} from './usage'

/**
 * Turns a queued signal into the threshold it actually is, or null for "say
 * nothing".
 *
 * `reached` arrives already decided — a cap refused work, and the refusal site
 * is the only place that knows. Everything else is a counter that moved, and
 * is judged here against the tier the flush has just looked up.
 *
 * The test is on the *value*, not on a delta: the claim row is what makes a
 * message happen once, so re-testing a metric that is already over is cheap
 * and correct. A cap of `null` is unlimited and never notifies; `0` is a
 * capability the tier does not have, which is a fact about the plan rather
 * than an allowance running out, and is left to BILL-4's wording to explain at
 * the point of refusal.
 */
const thresholdFor = async (
  userId: string,
  tier: PlanTier,
  metric: UsageMetric,
  signal: CapSignal,
): Promise<NotificationThreshold | null> => {
  if (signal === 'reached') return 'reached'
  const cap = capFor(tier, metric)
  if (cap === null || cap <= 0) return null
  const used = await usedThisPeriod(userId, metric)
  if (used >= cap) return 'reached'
  return used / cap >= USAGE_WARN_THRESHOLD ? 'approaching' : null
}

/**
 * Sends whatever is queued for one account. The queue calls this; nothing else
 * should.
 *
 * Order matters: the claim is taken *before* the message is built, so a metric
 * already notified this period drops out here rather than after the send. If
 * every metric drops out there is nothing left to say, and no mail goes.
 */
export const deliverPending = async (userId: string): Promise<void> => {
  const crossings = takePending(userId)
  if (!crossings.size) return

  const user = await UserModel.findById(userId)
    .select(`email displayName locale notifyCapWarnings ${PLAN_FIELDS}`)
    .catch(() => null)
  // A deleted account has no inbox. Its usage rows outlive it — they are what
  // BILL-7 reports on — but the person does not.
  if (!user) return

  const tier = effectivePlanTier(user)
  const period = await periodKeyFor(userId)

  /** Crossings this flush actually owns, after the per-period lock. */
  const claimed: { metric: UsageMetric; threshold: NotificationThreshold }[] =
    []
  for (const [metric, signal] of crossings) {
    const threshold = await thresholdFor(userId, tier, metric, signal)
    if (!threshold) continue
    // "Approaching" is advisory and the user may switch it off. "Reached"
    // explains why something they just attempted did not happen, so it is
    // transactional and always sent (BILL-8).
    if (threshold === 'approaching' && user.notifyCapWarnings === false)
      continue
    if (await claimNotification(userId, metric, period, threshold))
      claimed.push({ metric, threshold })
  }
  if (!claimed.length) return

  await deliver(
    {
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      tier,
    },
    claimed,
    userId,
  )
}

/** Who the message is for, and how to word it for them. */
interface Recipient {
  email: string
  displayName: string
  locale?: Locale
  tier: PlanTier
}

/**
 * Composes and sends one message covering every crossing claimed.
 *
 * A "reached" among them decides the whole message's tone and subject: an
 * account that has run out of one thing and is nearly out of another has, as
 * far as the sentence at the top goes, run out.
 */
const deliver = async (
  to: Recipient,
  claimed: { metric: UsageMetric; threshold: NotificationThreshold }[],
  userId: string,
): Promise<void> => {
  if (!mailerAvailable()) return

  const { locale, t, metricName } = capMessages(to.locale)
  const number = (value: number): string =>
    Math.round(value).toLocaleString(locale)
  const blocked = claimed.some(c => c.threshold === 'reached')

  const lines: string[] = [
    t('greeting', { name: to.displayName }),
    '',
    t(blocked ? 'intro.reached' : 'intro.approaching'),
    '',
  ]

  for (const { metric } of claimed) {
    // Audience allowances get their own sentence, and it reports counts.
    // Which students spent them is not here, and never will be: student
    // identities do not appear in instructor-facing messages (§16).
    const key = AUDIENCE_METRICS.includes(metric)
      ? 'line.usedOfCapAudience'
      : 'line.used'
    lines.push(
      t(key, {
        metric: metricName(metric),
        used: number(await usedThisPeriod(userId, metric)),
        cap: number(capFor(to.tier, metric) ?? 0),
      }),
    )
  }
  lines.push('')

  // A gauge does not reset with the period, so promising that it will would be
  // untrue. It says what actually makes it go down instead.
  if (claimed.some(c => isGaugeMetric(c.metric))) lines.push(t('gaugeNote'), '')

  const resetAt = await periodResetAt(userId).catch(() => null)
  lines.push(
    resetAt
      ? t('resets', {
          date: resetAt.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
        })
      : t('resetsNoPeriod'),
    '',
  )

  // The call to action follows the tier (BILL-5): there is nothing above Max,
  // so a Max user is invited to talk to us rather than shown a door that is
  // not there.
  lines.push(
    to.tier === 'max'
      ? t('cta.contact')
      : t('cta.upgrade', { link: `${appOrigin()}/app/plans` }),
  )

  // Only the advisory message mentions that it can be switched off; saying so
  // on an exhaustion notice would invite turning off the one that cannot be.
  if (!blocked) lines.push('', t('silence'))
  lines.push('', t('signoff'))

  try {
    await sendMail({
      to: to.email,
      subject: t(blocked ? 'subject.reached' : 'subject.approaching'),
      text: lines.join('\n'),
    })
  } catch (error) {
    // Logged, never raised. The claim row stays, so this is not retried — a
    // mail outage costs one notification, and the in-app notice is unaffected.
    console.error(`Could not mail cap notification to ${to.email}:`, error)
  }
}

/** Where the upgrade link points. */
const appOrigin = (): string =>
  env.CLIENT_APP_URL || env.PUBLIC_BASE_URL || 'http://localhost:3000'
