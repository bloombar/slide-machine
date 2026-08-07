/**
 * Ledger retention (SPEC BILL-7/P-11): roll each old month up, then drop the
 * rows behind it.
 *
 * The order is the whole design. Aggregate a month first, write its roll-up,
 * and only then delete that month's raw events — so a sweep interrupted between
 * the two leaves duplicated *detail*, which the next run resolves by replacing
 * the row, rather than deleted detail that was never summarized, which nothing
 * can resolve. Losing the summary is recoverable; losing the events is not.
 *
 * Two knobs, both configuration (TECH-4):
 *   COST_LEDGER_RETENTION_DAYS  how long raw events are kept (0 = forever)
 *   the sweep interval          daily, like the other retention jobs
 *
 * Only *complete* months are rolled up. The current month is still being
 * written to, and summarizing it would produce a figure that is wrong the
 * moment after it is written.
 */
import { Types } from 'mongoose'
import type { UsageMetric } from '@slide-machine/shared'
import { env } from '../config/env'
import { CostEventModel } from '../models/cost-event'
import { CostRollupModel, type RolledMetric } from '../models/cost-rollup'

const DAY_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = DAY_MS

/** The `YYYY-MM` a date belongs to, in UTC. */
const monthOf = (date: Date): string => date.toISOString().slice(0, 7)

/** First instant of the month after the one `date` is in, UTC. */
const monthEnd = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))

interface GroupedRow {
  _id: {
    month: string
    payerId: Types.ObjectId
    projectId: Types.ObjectId | null
    deckId: Types.ObjectId | null
  }
  projectName?: string
  deckName?: string
  instructorMicros: number
  audienceMicros: number
  systemMicros: number
  anonymousEvents: number
  students: Types.ObjectId[]
  metrics: {
    metric: UsageMetric
    quantity: number
    costMicros: number
    billable: boolean
  }[]
}

/** Collapses the per-event metric rows into one entry per metric. */
const foldMetrics = (rows: GroupedRow['metrics']): RolledMetric[] => {
  const byMetric = new Map<UsageMetric, RolledMetric>()
  for (const row of rows) {
    const entry = byMetric.get(row.metric) ?? {
      metric: row.metric,
      quantity: 0,
      costMicros: 0,
      events: 0,
      cachedEvents: 0,
    }
    entry.quantity += row.quantity
    entry.costMicros += row.costMicros
    entry.events += 1
    if (!row.billable) entry.cachedEvents += 1
    byMetric.set(row.metric, entry)
  }
  return [...byMetric.values()]
}

/**
 * Summarizes every complete month older than the cutoff and deletes the events
 * behind it. Returns what it did, so the caller can log something meaningful
 * rather than "sweep ran".
 */
export const rollUpExpiredCostEvents = async (
  olderThanDays: number = env.COST_LEDGER_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<{ months: number; rollups: number; deleted: number }> => {
  if (olderThanDays <= 0) return { months: 0, rollups: 0, deleted: 0 }

  const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS)
  // Never touch the month in progress, whatever the cutoff says: it is still
  // being written to, and a summary of it would be wrong immediately.
  const currentMonth = monthOf(now)

  const oldest = await CostEventModel.findOne({ occurredAt: { $lt: cutoff } })
    .sort({ occurredAt: 1 })
    .select('occurredAt')
    .lean()
  if (!oldest) return { months: 0, rollups: 0, deleted: 0 }

  let months = 0
  let rollups = 0
  let deleted = 0

  // Walk month by month from the oldest expired event, so one sweep catches up
  // however long the job has been off.
  for (
    let cursor = new Date(
      Date.UTC(
        oldest.occurredAt.getUTCFullYear(),
        oldest.occurredAt.getUTCMonth(),
        1,
      ),
    );
    cursor < cutoff && monthOf(cursor) !== currentMonth;
    cursor = monthEnd(cursor)
  ) {
    const month = monthOf(cursor)
    const end = monthEnd(cursor)
    // A month only ages out once *all* of it is past the cutoff; a partly
    // expired month would be summarized with half its events missing.
    if (end > cutoff) break
    const range = { occurredAt: { $gte: cursor, $lt: end } }

    const grouped = await CostEventModel.aggregate<GroupedRow>([
      { $match: range },
      {
        $group: {
          _id: {
            month,
            payerId: '$payerId',
            projectId: '$projectId',
            deckId: '$deckId',
          },
          projectName: { $last: '$projectName' },
          deckName: { $last: '$deckName' },
          instructorMicros: {
            $sum: {
              $cond: [{ $eq: ['$actorKind', 'owner'] }, '$costMicros', 0],
            },
          },
          audienceMicros: {
            $sum: {
              $cond: [{ $eq: ['$actorKind', 'audience'] }, '$costMicros', 0],
            },
          },
          systemMicros: {
            $sum: {
              $cond: [{ $eq: ['$actorKind', 'system'] }, '$costMicros', 0],
            },
          },
          anonymousEvents: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$actorKind', 'audience'] },
                    { $eq: ['$actorId', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          // Audience actors only, and only identified ones. The owner appears
          // on most of these rows as the actor of their own work and is not
          // one of their own students; an anonymous viewer has no identity to
          // add and is counted separately, as events.
          students: {
            $addToSet: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$actorKind', 'audience'] },
                    { $ne: ['$actorId', null] },
                  ],
                },
                '$actorId',
                '$$REMOVE',
              ],
            },
          },
          metrics: {
            $push: {
              metric: '$metric',
              quantity: '$quantity',
              costMicros: '$costMicros',
              billable: '$billable',
            },
          },
        },
      },
    ])

    if (!grouped.length) continue
    months += 1

    for (const row of grouped) {
      // Upsert, so a re-run replaces rather than doubles. The unique index on
      // the grain is what makes that safe under a concurrent sweep.
      await CostRollupModel.updateOne(
        {
          month,
          payerId: row._id.payerId,
          projectId: row._id.projectId,
          deckId: row._id.deckId,
        },
        {
          $set: {
            projectName: row.projectName,
            deckName: row.deckName,
            instructorMicros: row.instructorMicros,
            audienceMicros: row.audienceMicros,
            systemMicros: row.systemMicros,
            byMetric: foldMetrics(row.metrics),
            registeredStudents: row.students.length,
            anonymousEvents: row.anonymousEvents,
            rolledAt: new Date(),
          },
        },
        { upsert: true },
      )
      rollups += 1
    }

    // Only now, with the month summarized and written.
    deleted += (await CostEventModel.deleteMany(range)).deletedCount ?? 0
  }

  return { months, rollups, deleted }
}

/** Starts the daily sweep. No-op when retention is disabled. */
export const startCostRollupSweep = (): void => {
  if (env.COST_LEDGER_RETENTION_DAYS <= 0) return
  const run = (): void => {
    void rollUpExpiredCostEvents()
      .then(({ months, rollups, deleted }) => {
        if (deleted) {
          console.info(
            `Cost ledger: rolled up ${months} month(s) into ${rollups} row(s), removed ${deleted} event(s)`,
          )
        }
      })
      .catch(error => console.error('Cost roll-up sweep failed:', error))
  }
  run()
  setInterval(run, SWEEP_INTERVAL_MS).unref()
}
