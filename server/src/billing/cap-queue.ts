/**
 * The queue half of cap notifications (SPEC BILL-8), kept apart from the
 * sending half in `cap-notifications.ts`.
 *
 * The split exists for one reason: `usage.ts` has to be able to say "this
 * account just hit a cap", and the code that composes the email has to be able
 * to read caps and counters from `usage.ts`. Putting both in one module makes
 * that a cycle. Putting the announcement here — a file that imports nothing
 * but types — makes it a line.
 *
 * So this module knows only how to remember a crossing and when to hand it on.
 * It does not know what a plan is, what a cap is, or that email exists. The
 * flusher is pulled in lazily, inside the timer, which is also what keeps the
 * metering path from loading the mailer at all on a server where no cap is
 * ever reached.
 */
import type { UsageMetric } from '@slide-machine/shared'

/** Which of BILL-8's two moments a notification reports. */
export type NotificationThreshold = 'approaching' | 'reached'

/**
 * What the metering path knows when it queues something.
 *
 * `reached` is certain: a cap refused work, and only the refusal site can know
 * that. `check` is "this counter moved, someone should look" — deliberately
 * undecided, because deciding needs the account's tier and the metering path
 * does not have one. Resolving it in the flush costs a user lookup the flush
 * was making anyway, and costs the request nothing at all.
 */
export type CapSignal = NotificationThreshold | 'check'

/**
 * How long crossings are gathered before a message goes out.
 *
 * Long enough that the several caps one lecture can exhaust arrive together;
 * short enough that "you have run out" is not stale by the time it lands. Not
 * a delivery guarantee — a process that stops inside the window sends nothing,
 * and the in-app notice still tells the user.
 */
export const COALESCE_MS = 3_000

interface Pending {
  metrics: Map<UsageMetric, CapSignal>
  timer?: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

/** Whatever flush is currently running, so a test can wait for one. */
let inFlight: Promise<unknown> = Promise.resolve()

/** Runs one account's queued crossings, importing the sender only now. */
const runFlush = (userId: string): Promise<void> =>
  import('./cap-notifications')
    .then(mod => mod.deliverPending(userId))
    .catch(error => {
      // Never raised: BILL-8's "delivery never affects the request", applied
      // to the flush as well as to the request that queued it.
      console.error(`Cap notification for ${userId} failed:`, error)
    })

/**
 * Notes that a metric moved, or that it refused work, and arranges for the
 * account to hear about it.
 *
 * Returns immediately, having only written to a Map — it is called from the
 * metering path and must never be the reason a request is slower or fails.
 * Everything expensive happens on the timer, after the response.
 *
 * A `reached` supersedes anything else already queued for the same metric: a
 * user who crossed 80% and then 100% during one lecture wants to hear the
 * second thing, not the first.
 */
export const noteCapCrossing = (
  userId: string,
  metric: UsageMetric,
  signal: CapSignal,
): void => {
  const entry: Pending = pending.get(userId) ?? { metrics: new Map() }
  if (!(entry.metrics.get(metric) === 'reached' && signal !== 'reached'))
    entry.metrics.set(metric, signal)
  if (!entry.timer) {
    entry.timer = setTimeout(() => {
      inFlight = runFlush(userId)
    }, COALESCE_MS)
    // A pending notification must never be the reason a process stays alive.
    entry.timer.unref?.()
  }
  pending.set(userId, entry)
}

/**
 * Removes and returns one account's queued crossings. Called by the sender at
 * the start of a flush, so a crossing recorded while a message is being built
 * queues a fresh timer rather than being folded into a message already gone.
 */
export const takePending = (userId: string): Map<UsageMetric, CapSignal> => {
  const entry = pending.get(userId)
  pending.delete(userId)
  if (entry?.timer) clearTimeout(entry.timer)
  return entry?.metrics ?? new Map()
}

/**
 * Sends everything queued right now and waits for it.
 *
 * For tests, and for a shutdown that would rather deliver the last few notices
 * than drop them. Request paths never call it — the point of the queue is that
 * nobody waits.
 */
export const flushCapNotifications = async (): Promise<void> => {
  while (pending.size) {
    for (const userId of [...pending.keys()]) {
      const entry = pending.get(userId)
      if (entry?.timer) clearTimeout(entry.timer)
      if (entry) entry.timer = undefined
      await runFlush(userId)
    }
  }
  await inFlight
}

/** Test seam: drops anything queued without sending it. */
export const resetCapNotifications = (): void => {
  for (const entry of pending.values())
    if (entry.timer) clearTimeout(entry.timer)
  pending.clear()
  inFlight = Promise.resolve()
}
