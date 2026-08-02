/**
 * Unit tests for the parts of metering that need no database: cap lookup and
 * the unlimited short-circuit.
 *
 * `null` (unlimited) is worth covering even though no shipped tier uses it —
 * every cap in config/plans.json is finite, deliberately, since an unbounded
 * tier is an unbounded liability. The schema still permits null, so a
 * deployment can set it, and this is the path that would carry them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlansConfig } from '@slide-machine/shared'

const caps = {
  aiTokens: 1000,
  sttMinutes: 0,
  diarizationMinutes: null,
  ttsCharacters: 500,
  ttsPremiumCharacters: 0,
  aiImages: 0,
  imageLookups: null,
  importMb: null,
  exports: null,
  translationCharacters: 0,
  audioStorageMb: null,
  audienceTtsCharacters: null,
  audienceLocales: null,
}
const testPlans: PlansConfig = {
  free: { priceId: null, caps, audioRetentionDays: 7 },
  fresh: { priceId: 'p', caps, audioRetentionDays: 14 },
  pro: { priceId: 'p', caps, audioRetentionDays: 21 },
  max: { priceId: 'p', caps, audioRetentionDays: null },
}
vi.mock('../config/plans', () => ({ loadPlans: () => testPlans }))

// Guards that the unlimited path never reaches storage: if it did, these
// would throw rather than quietly returning the wrong answer.
vi.mock('../models/usage-record', () => ({
  UsageRecordModel: {
    findOne: () => {
      throw new Error('unlimited caps must not query usage')
    },
  },
}))
vi.mock('../models/subscription', () => ({
  SubscriptionModel: {
    findOne: () => {
      throw new Error('unlimited caps must not resolve a period')
    },
  },
}))

const { capFor, assertWithinCap, resetPlanCache } = await import('./usage')

beforeEach(resetPlanCache)

describe('capFor', () => {
  it('reads the cap for a tier and metric', () => {
    expect(capFor('free', 'aiTokens')).toBe(1000)
  })

  it('distinguishes unavailable (0) from unlimited (null)', () => {
    expect(capFor('free', 'sttMinutes')).toBe(0)
    expect(capFor('free', 'imageLookups')).toBeNull()
  })
})

describe('assertWithinCap', () => {
  it('returns immediately for an unlimited cap, without reading usage', async () => {
    await expect(
      assertWithinCap('user-1', 'free', 'imageLookups'),
    ).resolves.toBeUndefined()
  })
})
