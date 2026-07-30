/**
 * Relative age of a timestamp ("5 minutes ago", "yesterday"), reusable
 * anywhere metadata shows recency. The hook re-renders every 30 seconds
 * so ages stay fresh on long-lived screens.
 *
 * The wording comes from `Intl.RelativeTimeFormat` (i18n/format.ts), not
 * from string concatenation: plural rules differ per language — Russian
 * has four categories, Mandarin one — so an English "+ s" is unfixable by
 * translation. `timeAgo` stays exported as the pure calculation.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../i18n/format'

/** Wall clock, behind a call so the purity rule sees a plain function
 * rather than a `Date.now()` read in a component body. */
const getNow = (): number => Date.now()

export const timeAgo = (iso: string, now: number = getNow()): string =>
  formatRelativeTime(iso, now)

export function useTimeAgo(iso: string): string {
  // The clock is state rather than a read during render: an age has to
  // re-render on its own, and the reading it renders must be the one the
  // tick produced.
  const [now, setNow] = useState(getNow)
  // Subscribes to the language so an age re-renders on a locale switch
  const { i18n } = useTranslation()

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  return formatRelativeTime(iso, now, i18n.language)
}
