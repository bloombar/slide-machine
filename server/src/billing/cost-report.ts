/**
 * Reading the cost ledger (SPEC BILL-7): what the deployment spent, and who it
 * was spent on.
 *
 * Every figure here comes from the same collection of events, and the useful
 * ones all fall out of two facts recorded on each row: **who paid** and **who
 * acted**. That pair is what lets one ledger answer two different questions
 * from opposite directions — "what is this instructor costing us" and "what is
 * their audience costing them" — which need separating because the remedies
 * differ. One is a plan-sizing question; the other is an audience-reach one.
 *
 * Two counting rules run through everything and are worth stating once:
 *
 * - **Cache hits are rows too, at zero.** They are why the denominators are
 *   honest. A deck where two students trigger a translation and twenty-eight
 *   read the stored result cost what those two spent, but it reached *thirty*
 *   students, and an average over two would be an order of magnitude wrong.
 *   The same rows give the cache-hit ratio and the cost avoided for free.
 * - **Anonymous viewers are counted, not identified.** They arrive with no
 *   `actorId`, so they can be counted as events but never as people. Every
 *   per-student average here is therefore over *registered* students only, and
 *   the response says so rather than implying it covers everyone.
 */
import { Types } from 'mongoose'
import type { UsageMetric } from '@slide-machine/shared'
import { CostEventModel } from '../models/cost-event'
import { MICROS_PER_UNIT } from './pricing'

/** A window to report over. Absent ends are open. */
export interface CostWindow {
  from?: Date
  to?: Date
}

/** Money, as the API hands it out: exact micros plus a rendered figure, so no
 * client has to know the scale the ledger stores. */
export interface Money {
  micros: number
  /** Currency units, rounded to cents for display. */
  amount: number
  currency: string
}

/** One service's share of a total. */
export interface CostByMetric {
  metric: UsageMetric
  quantity: number
  cost: Money
  /** Events, billable and cached alike — how often it happened at all. */
  events: number
}

/** What one entity cost, split the way BILL-7 asks for. */
export interface CostSummary {
  total: Money
  /** Spend the payer caused themselves. */
  instructor: Money
  /** Spend their viewers caused, charged to them. */
  audience: Money
  /** Work the deployment caused on nobody's behalf — sweeps, backfills. */
  system: Money
  byMetric: CostByMetric[]
  /**
   * Registered students who caused billable-or-cached activity. Anonymous
   * viewers are absent by construction: they have no identity to count, and
   * inventing one to make them countable would conflict with §16.
   */
  registeredStudents: number
  /** Activity from viewers with no account, as an event count. */
  anonymousEvents: number
  /**
   * Audience spend divided by registered students, or null when none. Scoped
   * to registered students on purpose — see `registeredStudents`.
   */
  costPerRegisteredStudent: Money | null
  cache: CacheEfficiency
}

/** Whether caching is earning its complexity. */
export interface CacheEfficiency {
  billableEvents: number
  cachedEvents: number
  /** Cached ÷ all, 0–1; null when nothing has happened yet. */
  hitRatio: number | null
  /**
   * What the cached events would have cost had they been paid for, priced at
   * the same rate the billable ones for that metric actually averaged.
   *
   * An estimate, and labelled one: the ledger records a cache hit at zero
   * because it *was* zero, so the counterfactual has to be reconstructed. The
   * average rate the same metric really billed at is the least invented figure
   * available, and it is derived per metric rather than overall so that a
   * month of cheap image lookups cannot make avoided narration look cheap.
   */
  estimatedAvoided: Money
}

const currencyOf = async (): Promise<string> => {
  const row = await CostEventModel.findOne().select('currency').lean()
  return row?.currency ?? 'USD'
}

/** Wraps micros as money. */
const money = (micros: number, currency: string): Money => ({
  micros,
  amount: Math.round((micros / MICROS_PER_UNIT) * 100) / 100,
  currency,
})

/** The match stage for one scope and window. */
const matchFor = (
  scope: { payerId?: string; deckId?: string; projectId?: string },
  window: CostWindow = {},
): Record<string, unknown> => {
  const match: Record<string, unknown> = {}
  if (scope.payerId) match.payerId = new Types.ObjectId(scope.payerId)
  if (scope.deckId) match.deckId = new Types.ObjectId(scope.deckId)
  if (scope.projectId) match.projectId = new Types.ObjectId(scope.projectId)
  if (window.from || window.to) {
    match.occurredAt = {
      ...(window.from ? { $gte: window.from } : {}),
      ...(window.to ? { $lte: window.to } : {}),
    }
  }
  return match
}

/** Raw aggregation shape for the per-scope rollup. */
interface Facets {
  totals: { _id: string; cost: number; events: number }[]
  metrics: {
    _id: { metric: UsageMetric; billable: boolean }
    cost: number
    quantity: number
    events: number
  }[]
  students: { _id: null; ids: Types.ObjectId[] }[]
  anonymous: { _id: null; events: number }[]
}

/**
 * Everything one scope's panel needs, in a single round trip.
 *
 * A `$facet` rather than four queries because these are read together on every
 * admin page that shows cost, and four sequential scans of the same matched
 * set is three more than the question needs.
 */
export const costSummary = async (
  scope: { payerId?: string; deckId?: string; projectId?: string },
  window: CostWindow = {},
): Promise<CostSummary> => {
  const currency = await currencyOf()
  const [facets] = await CostEventModel.aggregate<Facets>([
    { $match: matchFor(scope, window) },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: '$actorKind',
              cost: { $sum: '$costMicros' },
              events: { $sum: 1 },
            },
          },
        ],
        metrics: [
          {
            $group: {
              _id: { metric: '$metric', billable: '$billable' },
              cost: { $sum: '$costMicros' },
              quantity: { $sum: '$quantity' },
              events: { $sum: 1 },
            },
          },
        ],
        // Distinct registered people who acted as audience. `$addToSet` rather
        // than a count, because the same student appears on many rows and the
        // question is how many people the deck reached, not how many playbacks.
        students: [
          { $match: { actorKind: 'audience', actorId: { $ne: null } } },
          { $group: { _id: null, ids: { $addToSet: '$actorId' } } },
        ],
        anonymous: [
          { $match: { actorKind: 'audience', actorId: null } },
          { $group: { _id: null, events: { $sum: 1 } } },
        ],
      },
    },
  ])

  const byKind = new Map(
    (facets?.totals ?? []).map(t => [t._id, t.cost] as const),
  )
  const instructor = byKind.get('owner') ?? 0
  const audience = byKind.get('audience') ?? 0
  const system = byKind.get('system') ?? 0

  const rows = facets?.metrics ?? []
  const perMetric = new Map<UsageMetric, CostByMetric>()
  let billableEvents = 0
  let cachedEvents = 0
  /** Billable cost and quantity per metric, for the avoided-cost estimate. */
  const billedRate = new Map<UsageMetric, { cost: number; quantity: number }>()
  const cachedQty = new Map<UsageMetric, number>()

  for (const row of rows) {
    const { metric, billable } = row._id
    const entry = perMetric.get(metric) ?? {
      metric,
      quantity: 0,
      cost: money(0, currency),
      events: 0,
    }
    entry.quantity += row.quantity
    entry.events += row.events
    entry.cost = money(entry.cost.micros + row.cost, currency)
    perMetric.set(metric, entry)

    if (billable) {
      billableEvents += row.events
      const rate = billedRate.get(metric) ?? { cost: 0, quantity: 0 }
      billedRate.set(metric, {
        cost: rate.cost + row.cost,
        quantity: rate.quantity + row.quantity,
      })
    } else {
      cachedEvents += row.events
      cachedQty.set(metric, (cachedQty.get(metric) ?? 0) + row.quantity)
    }
  }

  // Per metric, at the rate that metric really billed at. A metric that was
  // only ever served from cache has no rate to price against and contributes
  // nothing rather than a guess.
  let avoided = 0
  for (const [metric, quantity] of cachedQty) {
    const rate = billedRate.get(metric)
    if (!rate || rate.quantity <= 0) continue
    avoided += (rate.cost / rate.quantity) * quantity
  }

  const registeredStudents = facets?.students?.[0]?.ids.length ?? 0
  const totalEvents = billableEvents + cachedEvents

  return {
    total: money(instructor + audience + system, currency),
    instructor: money(instructor, currency),
    audience: money(audience, currency),
    system: money(system, currency),
    byMetric: [...perMetric.values()].sort(
      (a, b) => b.cost.micros - a.cost.micros,
    ),
    registeredStudents,
    anonymousEvents: facets?.anonymous?.[0]?.events ?? 0,
    costPerRegisteredStudent: registeredStudents
      ? money(Math.round(audience / registeredStudents), currency)
      : null,
    cache: {
      billableEvents,
      cachedEvents,
      hitRatio: totalEvents ? cachedEvents / totalEvents : null,
      estimatedAvoided: money(Math.round(avoided), currency),
    },
  }
}

/** One row of the biggest-spenders table. */
export interface TopSpender {
  payerId: string
  /** Denormalized at read time; a deleted account still shows its spend. */
  email?: string
  displayName?: string
  cost: Money
}

/** The deployment-wide picture (BILL-7's admin overview). */
export interface CostOverview {
  window: { from: string | null; to: string | null }
  totals: CostSummary
  /** Distinct accounts that spent anything in the window. */
  activeUsers: number
  /** Distinct registered students who caused activity in the window. */
  activeStudents: number
  /** Lectures and projects with at least one event, so the averages below
   * divide by what actually happened rather than by what exists. */
  lecturesWithSpend: number
  projectsWithSpend: number
  averages: {
    perUser: Money | null
    perLecture: Money | null
    perProject: Money | null
    perRegisteredStudent: Money | null
  }
  topSpenders: TopSpender[]
}

/**
 * The overview. Averages are per *active* entity — an account that spent
 * nothing is not a cheap user, it is not a user of anything, and including it
 * would make the deployment look cheaper the more dormant accounts it has.
 */
export const costOverview = async (
  window: CostWindow = {},
  { topLimit = 10 }: { topLimit?: number } = {},
): Promise<CostOverview> => {
  const currency = await currencyOf()
  const totals = await costSummary({}, window)
  const match = matchFor({}, window)

  const [counts] = await CostEventModel.aggregate<{
    users: { _id: null; ids: Types.ObjectId[] }[]
    decks: { _id: null; ids: Types.ObjectId[] }[]
    projects: { _id: null; ids: Types.ObjectId[] }[]
  }>([
    { $match: match },
    {
      $facet: {
        users: [{ $group: { _id: null, ids: { $addToSet: '$payerId' } } }],
        decks: [
          { $match: { deckId: { $ne: null } } },
          { $group: { _id: null, ids: { $addToSet: '$deckId' } } },
        ],
        projects: [
          { $match: { projectId: { $ne: null } } },
          { $group: { _id: null, ids: { $addToSet: '$projectId' } } },
        ],
      },
    },
  ])

  const activeUsers = counts?.users?.[0]?.ids.length ?? 0
  const lecturesWithSpend = counts?.decks?.[0]?.ids.length ?? 0
  const projectsWithSpend = counts?.projects?.[0]?.ids.length ?? 0

  const top = await CostEventModel.aggregate<{
    _id: Types.ObjectId
    cost: number
    user?: { email?: string; displayName?: string }[]
  }>([
    { $match: match },
    { $group: { _id: '$payerId', cost: { $sum: '$costMicros' } } },
    { $sort: { cost: -1 } },
    { $limit: topLimit },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
        pipeline: [{ $project: { email: 1, displayName: 1 } }],
      },
    },
  ])

  const per = (value: number, divisor: number): Money | null =>
    divisor > 0 ? money(Math.round(value / divisor), currency) : null

  return {
    window: {
      from: window.from?.toISOString() ?? null,
      to: window.to?.toISOString() ?? null,
    },
    totals,
    activeUsers,
    activeStudents: totals.registeredStudents,
    lecturesWithSpend,
    projectsWithSpend,
    averages: {
      perUser: per(totals.total.micros, activeUsers),
      perLecture: per(totals.total.micros, lecturesWithSpend),
      perProject: per(totals.total.micros, projectsWithSpend),
      perRegisteredStudent: per(
        totals.audience.micros,
        totals.registeredStudents,
      ),
    },
    topSpenders: top.map(row => ({
      payerId: row._id.toString(),
      email: row.user?.[0]?.email,
      displayName: row.user?.[0]?.displayName,
      cost: money(row.cost, currency),
    })),
  }
}
