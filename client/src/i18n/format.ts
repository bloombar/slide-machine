/**
 * Locale-aware formatting over the Intl APIs (TECH-12). Everything here
 * reads the active interface language by default, so switching it
 * reformats dates, numbers and ages the same way it re-translates text.
 *
 * These replace hand-rolled English formatting: pluralization and unit
 * names are things only Intl gets right across five languages (Russian
 * has four plural categories, Mandarin has one).
 *
 * Intl formatters are comparatively expensive to construct, so each kind
 * is memoized per locale — the same handful is reused for the life of
 * the page.
 */
import { currentLocale } from './index'

/** Memoizes one formatter per cache key (locale plus any options). */
const memoize = <T>(build: (key: string) => T): ((key: string) => T) => {
  const cache = new Map<string, T>()
  return key => {
    const hit = cache.get(key)
    if (hit) return hit
    const made = build(key)
    cache.set(key, made)
    return made
  }
}

const relativeFormatter = memoize(
  locale => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
)

/** Coarsest unit that still describes an age, largest last. */
const AGE_UNITS: Array<{
  limit: number
  divisor: number
  unit: Intl.RelativeTimeFormatUnit
}> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 604800, divisor: 86400, unit: 'day' },
  { limit: 2629800, divisor: 604800, unit: 'week' },
  { limit: 31557600, divisor: 2629800, unit: 'month' },
  { limit: Infinity, divisor: 31557600, unit: 'year' },
]

/**
 * How long ago a timestamp was, in words — "5 minutes ago", "yesterday",
 * "2 weeks ago". Anything under ten seconds reads as "now".
 *
 * `numeric: 'auto'` is what yields "yesterday" over "1 day ago"; it is
 * the phrasing a reader expects in every language we ship.
 */
export const formatRelativeTime = (
  iso: string,
  now: number = Date.now(),
  locale: string = currentLocale(),
): string => {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  const { divisor, unit } =
    AGE_UNITS.find(u => seconds < u.limit) ?? AGE_UNITS[AGE_UNITS.length - 1]!
  const value = Math.floor(seconds / divisor)
  const format = relativeFormatter(locale)
  // "0 seconds ago" is never what anyone means by a fresh timestamp
  if (unit === 'second' && value < 10) return format.format(0, 'second')
  return format.format(-value, unit)
}

const dateFormatter = memoize(key => {
  const [locale, style] = key.split('|') as [string, 'short' | 'long']
  return new Intl.DateTimeFormat(
    locale,
    style === 'long'
      ? {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  )
})

/** A date ("23 Jul 2026"), or with `style: 'long'` a date and time. */
export const formatDate = (
  iso: string | number | Date,
  style: 'short' | 'long' = 'short',
  locale: string = currentLocale(),
): string => dateFormatter(`${locale}|${style}`).format(new Date(iso))

const numberFormatter = memoize(locale => new Intl.NumberFormat(locale))

/** A plain number with the locale's grouping and decimal separators. */
export const formatNumber = (
  value: number,
  locale: string = currentLocale(),
): string => numberFormatter(locale).format(value)

/** Byte-count units, smallest first; each step is 1024 of the last. */
const SIZE_UNITS = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
] as const

/**
 * A file size with its unit ("2.4 MB"), scaled to the largest unit that
 * leaves a number above 1. Intl names the unit, so it is translated and
 * placed by locale rather than concatenated.
 */
export const formatFileSize = (
  bytes: number,
  locale: string = currentLocale(),
): string => {
  let value = Math.max(0, bytes)
  let step = 0
  while (value >= 1024 && step < SIZE_UNITS.length - 1) {
    value /= 1024
    step += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: SIZE_UNITS[step],
    unitDisplay: 'short',
    // Whole bytes; a fraction of a byte is meaningless
    maximumFractionDigits: step === 0 ? 0 : 1,
  }).format(value)
}

/**
 * An amount of money. Unused by the UI today — plans and billing
 * (BILL-*) land in this phase and should not re-invent it.
 */
export const formatCurrency = (
  amount: number,
  currency: string,
  locale: string = currentLocale(),
): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
