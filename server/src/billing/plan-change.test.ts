/**
 * Unit tests for what moving down a plan would cost (SPEC BILL-5/P-10).
 *
 * The point of the module is the warning, so most of these are about *not*
 * crying wolf — an upgrade, a deployment with the sweep switched off, or a
 * tier whose window is already the deployment's all delete nothing and must
 * say so — and about the one case that does: a shorter window that leaves
 * recordings the user still has on the wrong side of the cutoff.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlanTier } from '@slide-machine/shared'

/** Retention per tier, mirroring the shipped shape: smaller plans keep less. */
const RETENTION: Record<string, number | null> = {
  free: 7,
  fresh: 14,
  pro: 21,
  max: 30,
}

const testEnv = { AUDIO_RETENTION_DAYS: 90 }
vi.mock('../config/env', () => ({ env: testEnv }))

vi.mock('../config/plans', () => ({
  loadPlans: () =>
    Object.fromEntries(
      Object.entries(RETENTION).map(([tier, days]) => [
        tier,
        { priceId: null, audioRetentionDays: days, caps: {} },
      ]),
    ),
}))

/** One retained recording, `age` days old. */
const recording = (age: number) => ({
  createdAt: new Date(NOW - age * 24 * 60 * 60 * 1000),
})

/** Lectures the fake DeckModel answers with, newest filter applied by hand. */
let decks: {
  _id: string
  title: string
  /** Absent on a lecture that has never been recorded, as in the database. */
  recordings?: { createdAt: Date }[]
}[] = []

vi.mock('../models/deck', () => ({
  DeckModel: {
    find: (filter: Record<string, unknown>) => ({
      select: () => {
        // The real query pre-filters to decks holding at least one expired
        // recording; mirroring it here keeps the per-deck counting honest.
        const cutoff = (
          filter['recordings.createdAt'] as { $lt: Date } | undefined
        )?.$lt
        return Promise.resolve(
          decks
            .filter(deck =>
              cutoff
                ? (deck.recordings ?? []).some(rec => rec.createdAt < cutoff)
                : true,
            )
            .map(deck => ({ ...deck, _id: { toString: () => deck._id } })),
        )
      },
    }),
  },
}))

/** The account's subscription, or null for one that has never subscribed. */
let subscription: {
  providerSubscriptionId: string
  status: string
  currentPeriodEnd?: Date
} | null = null

vi.mock('../models/subscription', () => ({
  SubscriptionModel: { findOne: () => Promise.resolve(subscription) },
}))

const NOW = Date.UTC(2026, 7, 3)

const {
  planChangeImpact,
  isDowngrade,
  retentionWindowFor,
  NAMED_LECTURE_LIMIT,
} = await import('./plan-change')

const impact = (current: PlanTier, tier: PlanTier) =>
  planChangeImpact('user-1', current, tier, NOW)

beforeEach(() => {
  testEnv.AUDIO_RETENTION_DAYS = 90
  decks = []
  subscription = {
    providerSubscriptionId: 'sub_1',
    status: 'active',
    currentPeriodEnd: new Date(Date.UTC(2026, 8, 1)),
  }
})

describe('isDowngrade', () => {
  it('is true only for a tier below the current one', () => {
    expect(isDowngrade('fresh', 'pro')).toBe(true)
    expect(isDowngrade('max', 'pro')).toBe(false)
    expect(isDowngrade('pro', 'pro')).toBe(false)
  })
})

describe('retentionWindowFor', () => {
  it('takes the shorter of the tier’s window and the deployment’s', () => {
    testEnv.AUDIO_RETENTION_DAYS = 10
    expect(retentionWindowFor('pro')).toBe(10)
    expect(retentionWindowFor('free')).toBe(7)
  })

  it('is null when the deployment keeps everything', () => {
    // AUDIO_RETENTION_DAYS=0 switches the sweep off entirely, so no tier can
    // tighten what is not running — and nothing is ever deleted.
    testEnv.AUDIO_RETENTION_DAYS = 0
    expect(retentionWindowFor('free')).toBeNull()
  })
})

describe('planChangeImpact', () => {
  it('names the lectures whose recordings fall outside the new window', async () => {
    decks = [
      {
        _id: 'deck-1',
        title: 'Week 4 — Sorting',
        // 20 days old: kept on Pro (21), past the limit on Fresh (14).
        recordings: [recording(20), recording(16), recording(2)],
      },
      {
        _id: 'deck-2',
        title: 'Week 5 — Recursion',
        recordings: [recording(1)],
      },
    ]

    const result = await impact('pro', 'fresh')

    expect(result.isDowngrade).toBe(true)
    expect(result.currentRetentionDays).toBe(21)
    expect(result.nextRetentionDays).toBe(14)
    expect(result.recordingsRemoved).toBe(2)
    expect(result.lecturesAffected).toBe(1)
    expect(result.lectures).toEqual([
      { deckId: 'deck-1', title: 'Week 4 — Sorting', recordings: 2 },
    ])
  })

  it('counts every affected lecture but names only the first few', async () => {
    // A user with more affected lectures than the dialog can list gets the
    // exact count regardless, so a truncated list never reads as the whole of it.
    decks = Array.from({ length: NAMED_LECTURE_LIMIT + 3 }, (_, index) => ({
      _id: `deck-${index}`,
      title: `Lecture ${index}`,
      recordings: [recording(20)],
    }))

    const result = await impact('pro', 'fresh')

    expect(result.recordingsRemoved).toBe(NAMED_LECTURE_LIMIT + 3)
    expect(result.lecturesAffected).toBe(NAMED_LECTURE_LIMIT + 3)
    expect(result.lectures).toHaveLength(NAMED_LECTURE_LIMIT)
  })

  it('lists the worst-affected lectures first', async () => {
    decks = [
      { _id: 'deck-1', title: 'One', recordings: [recording(20)] },
      {
        _id: 'deck-2',
        title: 'Three',
        recordings: [recording(20), recording(20), recording(20)],
      },
    ]

    const result = await impact('pro', 'fresh')

    expect(result.lectures.map(lecture => lecture.title)).toEqual([
      'Three',
      'One',
    ])
  })

  it('deletes nothing when moving up', async () => {
    decks = [{ _id: 'deck-1', title: 'Old', recordings: [recording(20)] }]

    const result = await impact('fresh', 'pro')

    expect(result.isDowngrade).toBe(false)
    expect(result.recordingsRemoved).toBe(0)
    expect(result.lectures).toEqual([])
  })

  it('deletes nothing when the deployment’s sweep is off', async () => {
    testEnv.AUDIO_RETENTION_DAYS = 0
    decks = [{ _id: 'deck-1', title: 'Ancient', recordings: [recording(400)] }]

    const result = await impact('pro', 'free')

    expect(result.currentRetentionDays).toBeNull()
    expect(result.nextRetentionDays).toBeNull()
    expect(result.recordingsRemoved).toBe(0)
  })

  it('deletes nothing when the deployment already keeps less than either tier', async () => {
    // Both tiers are bounded by the deployment's 5 days, so moving down
    // changes no window and the sweep would have taken the same audio anyway.
    testEnv.AUDIO_RETENTION_DAYS = 5
    decks = [{ _id: 'deck-1', title: 'Old', recordings: [recording(20)] }]

    const result = await impact('pro', 'fresh')

    expect(result.currentRetentionDays).toBe(5)
    expect(result.nextRetentionDays).toBe(5)
    expect(result.recordingsRemoved).toBe(0)
  })

  it('ignores a lecture that holds no recordings', async () => {
    // The query pre-filters to decks with expired audio, but a deck whose
    // recordings were pulled between the two must not be counted or named.
    decks = [{ _id: 'deck-1', title: 'Nothing recorded', recordings: [] }]

    const result = await impact('pro', 'fresh')

    expect(result.recordingsRemoved).toBe(0)
    expect(result.lectures).toEqual([])
  })

  it('falls back to the deployment’s window for a tier the config omits', async () => {
    // A config that has not caught up with a new tier degrades to permissive
    // rather than refusing to answer (BILL-6).
    testEnv.AUDIO_RETENTION_DAYS = 30
    expect(retentionWindowFor('enterprise' as PlanTier)).toBe(30)
  })

  it('states no date when the subscription records no period end', async () => {
    subscription = { providerSubscriptionId: 'sub_1', status: 'active' }

    const result = await impact('pro', 'free')

    expect(result.effective).toBe('period_end')
    expect(result.effectiveAt).toBeNull()
  })

  it('reports a move to free as ending at the paid period’s end', async () => {
    const result = await impact('pro', 'free')

    expect(result.effective).toBe('period_end')
    expect(result.effectiveAt).toBe(
      new Date(Date.UTC(2026, 8, 1)).toISOString(),
    )
    expect(result.changeable).toBe(true)
  })

  it('reports a paid-to-paid move as immediate', async () => {
    const result = await impact('pro', 'fresh')

    expect(result.effective).toBe('immediately')
    expect(result.effectiveAt).toBeNull()
  })

  it('is not changeable without a live subscription', async () => {
    subscription = null
    expect((await impact('pro', 'fresh')).changeable).toBe(false)

    subscription = { providerSubscriptionId: 'sub_1', status: 'canceled' }
    expect((await impact('pro', 'fresh')).changeable).toBe(false)
  })

  it('is not changeable for a move that is a purchase, or no move at all', async () => {
    expect((await impact('fresh', 'pro')).changeable).toBe(false)
    expect((await impact('pro', 'pro')).changeable).toBe(false)
  })
})
