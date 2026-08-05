/**
 * A fixed-window rate limiter, in memory.
 *
 * It exists for endpoints that are open to anyone and cost something to
 * serve — the feedback form sends an email — where the point is to make
 * automated abuse tedious, not to enforce a quota. Plan allowances are a
 * different thing entirely and live in billing/limits.
 *
 * In memory means per process: a deployment running several instances
 * multiplies the limit by however many there are, and a restart forgets
 * every window. Both are acceptable for a nuisance guard and neither is for
 * anything stronger.
 */

/** Counts hits per key, and says whether this one is over the line. */
export interface RateLimiter {
  /** Records a hit and returns true when it is within the limit. */
  take(key: string): boolean
  /** Forgets every window — for tests. */
  reset(): void
}

interface Window {
  count: number
  /** When the window closes, in epoch milliseconds. */
  expiresAt: number
}

export const createRateLimiter = ({
  limit,
  windowMs,
}: {
  limit: number
  windowMs: number
}): RateLimiter => {
  const windows = new Map<string, Window>()

  /** Drops closed windows, so a stream of one-off keys (every caller has
   * their own address) cannot grow the map without bound. */
  const prune = (now: number): void => {
    for (const [key, window] of windows) {
      if (window.expiresAt <= now) windows.delete(key)
    }
  }

  return {
    take(key) {
      const now = Date.now()
      prune(now)
      const window = windows.get(key)
      if (!window || window.expiresAt <= now) {
        windows.set(key, { count: 1, expiresAt: now + windowMs })
        return true
      }
      window.count += 1
      return window.count <= limit
    },
    reset() {
      windows.clear()
    },
  }
}
