/**
 * Relative age of a timestamp ("5 minutes ago", "2 weeks ago"), reusable
 * anywhere metadata shows recency. The hook re-renders every 30 seconds
 * so ages stay fresh on long-lived screens; `timeAgo` is the pure
 * calculation, exported for reuse and testing.
 */
import { useEffect, useState } from 'react'

const UNITS: Array<{ limit: number; divisor: number; unit: string }> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 604800, divisor: 86400, unit: 'day' },
  { limit: 2629800, divisor: 604800, unit: 'week' },
  { limit: 31557600, divisor: 2629800, unit: 'month' },
  { limit: Infinity, divisor: 31557600, unit: 'year' },
]

export const timeAgo = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  const { divisor, unit } =
    UNITS.find(u => seconds < u.limit) ?? UNITS[UNITS.length - 1]!
  const value = Math.floor(seconds / divisor)
  if (unit === 'second' && value < 10) return 'just now'
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`
}

export function useTimeAgo(iso: string): string {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  return timeAgo(iso)
}
