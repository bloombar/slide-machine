/**
 * Presentation rules for metered usage (SPEC BILL-4). Pure functions, kept
 * out of the components so the decisions that matter — what counts as "close
 * to a limit", which call to action a tier gets — are testable without a DOM
 * and identical wherever usage is shown.
 */
import {
  USAGE_WARN_THRESHOLD,
  type PlanTier,
  type UsageMetric,
  type UsageMetricSummary,
  type UsageUnit,
} from '@slide-machine/shared'
import { formatNumber } from '../i18n/format'

/**
 * Metrics worth surfacing unprompted: at or past the warning threshold, worst
 * first. Unlimited metrics have no fraction and so can never qualify — there
 * is nothing to run out of.
 *
 * The same threshold BILL-8 emails on, so the app never warns about something
 * it is not also showing, or the reverse.
 */
export const approachingLimits = (
  metrics: UsageMetricSummary[],
): UsageMetricSummary[] =>
  metrics
    .filter(m => m.fraction !== null && m.fraction >= USAGE_WARN_THRESHOLD)
    .sort((a, b) => (b.fraction ?? 0) - (a.fraction ?? 0))

/** Whether a metric has no allowance left. Distinct from "approaching": one
 * is a warning, the other is why something just refused to happen. */
export const isExhausted = (m: UsageMetricSummary): boolean =>
  m.fraction !== null && m.fraction >= 1

/**
 * Which call to action a tier gets (BILL-4/BILL-5). Max has no larger plan to
 * move to, so offering an upgrade would send the user looking for a page that
 * cannot exist; they are invited to get in touch instead.
 */
export const callToActionFor = (tier: PlanTier): 'upgrade' | 'contact' =>
  tier === 'max' ? 'contact' : 'upgrade'

/**
 * Roughly how many characters of text a minute of speech takes: about 150
 * words a minute at six characters a word, space included. An approximation on
 * purpose — narration is billed per character, and nobody choosing a plan
 * thinks in characters.
 */
const CHARACTERS_PER_SPOKEN_MINUTE = 900

/** Average characters per written word, the space after it included. */
const CHARACTERS_PER_WORD = 6

/** Past this many minutes, an allowance reads better in hours. */
const MINUTES_AS_HOURS = 120

/**
 * How a plan's allowance is described to someone choosing a plan, where the
 * billed unit is not the one they think in. Character counts become time spoken
 * or words written; a count of locales becomes languages.
 *
 * Only these five are re-expressed. The rest are already in units a reader
 * recognizes — minutes recorded, images, exports, megabytes — and dressing
 * them up would only put a guess between the user and their allowance.
 */
const FRIENDLY_UNITS: Partial<
  Record<UsageMetric, 'spoken' | 'words' | 'languages' | 'tokens'>
> = {
  ttsCharacters: 'spoken',
  ttsPremiumCharacters: 'spoken',
  audienceTtsCharacters: 'spoken',
  translationCharacters: 'words',
  audienceLocales: 'languages',
  // Not re-expressed, only named: how many tokens a lecture takes depends on
  // how much refining and quizzing it gets, so any conversion to "lectures"
  // would be a guess dressed as a promise. A bare seven-digit number, though,
  // does not say what it counts.
  aiTokens: 'tokens',
}

/**
 * A cap in everyday terms — "about 65 min of narration", "about 1,500 words",
 * "2 languages" — or null for a metric that is already plain, leaving the
 * caller to format the raw number.
 *
 * The spoken and written figures are explicitly approximate, and say so in the
 * words they use: they are derived from an average, and a plan that promised an
 * exact number of minutes would be promising something it does not meter.
 */
export const friendlyCap = (
  metric: UsageMetric,
  cap: number,
  translate: (key: string, vars: Record<string, unknown>) => string,
): string | null => {
  const kind = FRIENDLY_UNITS[metric]
  if (!kind) return null

  if (kind === 'languages') {
    return translate('plan.pricing.approx.languages', { count: cap })
  }
  if (kind === 'tokens') {
    // Millions, because token allowances run to seven and eight digits and
    // "5M" is read at a glance where "5,000,000" is counted digit by digit.
    // One decimal only where it is not a whole million (7.5M), never "5.0M".
    const millions = cap / 1_000_000
    return translate('plan.pricing.approx.tokens', {
      value: formatNumber(
        Number.isInteger(millions) ? millions : Math.round(millions * 10) / 10,
      ),
    })
  }
  if (kind === 'words') {
    return translate('plan.pricing.approx.words', {
      value: formatNumber(Math.round(cap / CHARACTERS_PER_WORD)),
    })
  }

  const minutes = cap / CHARACTERS_PER_SPOKEN_MINUTE
  return minutes >= MINUTES_AS_HOURS
    ? translate('plan.pricing.approx.spokenHours', {
        value: formatNumber(Math.round(minutes / 60)),
      })
    : translate('plan.pricing.approx.spokenMinutes', {
        value: formatNumber(Math.round(minutes)),
      })
}

/** i18n key for a unit's suffix, or null when the metric's own label already
 * says what is being counted ("Narration — 12,000 of 60,000"). */
const UNIT_KEY: Partial<Record<UsageUnit, string>> = {
  minutes: 'usage.unit.minutes',
  mb: 'usage.unit.mb',
}

/**
 * Formats an amount for display, rounding to whole units — a quota is read at
 * a glance, and "1,920.37 MB" is no more useful than "1,920".
 *
 * `translate` is passed in rather than imported so this stays a pure function
 * and the caller supplies the hook's `t` it already has.
 */
export const formatAmount = (
  value: number,
  unit: UsageUnit,
  translate: (key: string, vars: Record<string, unknown>) => string,
): string => {
  const number = formatNumber(Math.round(value))
  const key = UNIT_KEY[unit]
  return key ? translate(key, { value: number }) : number
}
