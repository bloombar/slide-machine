/**
 * Ambient attribution for metered work (SPEC BILL-3).
 *
 * The provider adapters are where the real numbers are — Gemini reports token
 * counts, the STT stream knows its own duration — but they are deliberately
 * ignorant of users: `GenerationProvider.generateSlideContent` takes a prompt,
 * not an account. Threading a userId through every provider interface would
 * put billing concepts inside the vendor seam that TECH-8 exists to keep
 * clean.
 *
 * So the acting user rides along out-of-band: whoever knows it (an action
 * dispatch, a WebSocket session) runs the work inside `runWithUsage`, and any
 * depth of the call stack can meter against it. Work with no context —
 * seeding, background jobs, tests — is simply not metered, which is the right
 * default: nobody asked for it, so nobody's allowance pays for it.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { UsageMetric } from '@slide-machine/shared'
import { recordUsage } from './usage'

interface UsageAttribution {
  /** Who pays. For audience work this is the deck's owner, not the viewer. */
  userId: string
}

const storage = new AsyncLocalStorage<UsageAttribution>()

/** Runs `fn` with usage attributed to `userId`. */
export const runWithUsage = <T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> => storage.run({ userId }, fn)

/**
 * Runs `fn` with no one to attribute usage to, even inside a context that has
 * one.
 *
 * For work the app does for its own chrome rather than for a lecture: the
 * placeholder pictures in the template editor's preview are the case this
 * exists for. They go through the same image search a real slide does, and
 * that search meters itself — correctly, since it has no way to know who
 * asked. Nobody browsing their own template should spend an image lookup on a
 * picture that is only there to show what a layout looks like.
 *
 * `AsyncLocalStorage.exit` drops the store for the callback and everything it
 * awaits, so `meterUsage` deep inside finds no user and no-ops by its own
 * documented rule.
 */
export const runUnmetered = <T>(fn: () => Promise<T>): Promise<T> =>
  storage.exit(fn)

/** The user currently being metered, if any. */
export const currentUsageUser = (): string | undefined =>
  storage.getStore()?.userId

/**
 * Records usage against whoever the ambient context names. A no-op outside a
 * context, so an adapter can meter unconditionally without knowing whether its
 * caller was a user request or a background sweep.
 */
export const meterUsage = async (
  metric: UsageMetric,
  quantity: number,
  options?: { billable?: boolean },
): Promise<void> => {
  const userId = currentUsageUser()
  if (!userId || quantity <= 0) return
  await recordUsage(userId, metric, quantity, options)
}
