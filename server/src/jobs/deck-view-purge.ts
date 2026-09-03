/**
 * View-record retention (SPEC EVAL-7/P-11): drop lecture openings older than
 * the configured window.
 *
 * `DeckView` is the second collection in the product that grows with *usage*
 * rather than with content — the cost ledger is the other — so it needs the
 * same kind of bound, for the same reason: a deployment three years in has far
 * more rows than any report reads.
 *
 * Unlike the cost ledger there is nothing to roll up first. A ledger row
 * carries money that has to survive as a monthly total; a view carries only
 * that somebody opened a lecture, and a count of those is a query anyone can
 * run against the live rows while they exist. So this deletes rather than
 * summarizes, and a sweep interrupted halfway simply resumes tomorrow.
 *
 * One knob, configuration like the others (TECH-4):
 *   DECK_VIEW_RETENTION_DAYS   how long openings are kept (0 = forever)
 */
import { env } from '../config/env'
import { DeckViewModel } from '../models/deck-view'

const DAY_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = DAY_MS

/**
 * Deletes view records older than the window and reports how many went, so
 * the caller can log something meaningful rather than "sweep ran".
 *
 * A window of zero or less means "keep forever" and does nothing at all —
 * deliberately not "delete everything", which is what a naive cutoff of `now`
 * would do to a deployment that had simply turned retention off.
 */
export const purgeExpiredDeckViews = async (
  olderThanDays: number = env.DECK_VIEW_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<{ deleted: number }> => {
  if (olderThanDays <= 0) return { deleted: 0 }
  const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS)
  const { deletedCount } = await DeckViewModel.deleteMany({
    occurredAt: { $lt: cutoff },
  })
  return { deleted: deletedCount ?? 0 }
}

/** Starts the daily sweep. No-op when retention is disabled. */
export const startDeckViewPurgeSweep = (): void => {
  if (env.DECK_VIEW_RETENTION_DAYS <= 0) return
  const run = (): void => {
    void purgeExpiredDeckViews()
      .then(({ deleted }) => {
        if (deleted) {
          console.info(`Deck views: removed ${deleted} expired record(s)`)
        }
      })
      .catch(error => console.error('Deck view purge sweep failed:', error))
  }
  run()
  setInterval(run, SWEEP_INTERVAL_MS).unref()
}
