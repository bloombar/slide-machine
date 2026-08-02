/**
 * Unit tests for how a synthesis is charged: which allowance it draws on and
 * when it is refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Caps per tier, mirroring the shipped shape: every tier offers every voice,
 * a cheaper one simply gets fewer characters of each. */
const CAPS: Record<string, Record<string, number | null>> = {
  free: {
    ttsCharacters: 60_000,
    ttsPremiumCharacters: 20_000,
    audienceTtsCharacters: 25_000,
  },
  pro: {
    ttsCharacters: 800_000,
    ttsPremiumCharacters: 100_000,
    audienceTtsCharacters: 450_000,
  },
  max: {
    ttsCharacters: null,
    ttsPremiumCharacters: null,
    audienceTtsCharacters: null,
  },
}

let used: Record<string, number> = {}

vi.mock('./usage', async () => {
  const { PlanLimitExceededError } = await import('./limits')
  const capFor = (tier: string, metric: string) => CAPS[tier]?.[metric] ?? null
  return {
    capFor,
    assertWithinCap: async (
      _userId: string,
      tier: string,
      metric: string,
      message?: string,
    ) => {
      const cap = capFor(tier, metric)
      if (cap === null) return
      const spent = used[metric] ?? 0
      if (spent >= cap) {
        throw new PlanLimitExceededError(
          metric as never,
          cap,
          spent,
          message ?? undefined,
        )
      }
    },
  }
})

const { assertTtsCapacity, ttsMetricFor } = await import('./tts-usage')
const { PlanLimitExceededError } = await import('./limits')
type PlanLimitError = InstanceType<typeof PlanLimitExceededError>

beforeEach(() => {
  used = {}
})

/** Runs a check and returns the error it threw, or null when it allowed. */
const attempt = async (
  tier: string,
  actor: 'author' | 'audience',
  premium: boolean,
): Promise<PlanLimitError | null> => {
  try {
    await assertTtsCapacity('u1', tier as never, actor, premium)
    return null
  } catch (error) {
    return error as PlanLimitError
  }
}

describe('ttsMetricFor', () => {
  it('charges an author’s standard synthesis to the authoring allowance', () => {
    expect(ttsMetricFor('author', false)).toBe('ttsCharacters')
  })

  it('charges an author’s premium synthesis to the premium allowance', () => {
    expect(ttsMetricFor('author', true)).toBe('ttsPremiumCharacters')
  })

  it('charges a listener to the audience allowance whatever the voice', () => {
    // There is no audience-premium metric on purpose: the audience pool is
    // sized in characters, and premium is the owner's capability.
    expect(ttsMetricFor('audience', false)).toBe('audienceTtsCharacters')
    expect(ttsMetricFor('audience', true)).toBe('audienceTtsCharacters')
  })
})

describe('assertTtsCapacity', () => {
  it('allows an author with allowance left', async () => {
    used = { ttsCharacters: 1000 }
    expect(await attempt('free', 'author', false)).toBeNull()
  })

  it('refuses an author whose narration allowance is spent', async () => {
    used = { ttsCharacters: 60_000 }
    const error = await attempt('free', 'author', false)
    expect(error).toBeInstanceOf(PlanLimitExceededError)
    expect(error?.metric).toBe('ttsCharacters')
    expect(error?.message).toMatch(/used all of this billing period/i)
  })

  it('tells a blocked listener nothing about the owner’s billing', async () => {
    // The viewer-safe rule (BILL-4): a student learns the audio is missing,
    // never that their instructor ran out of allowance.
    used = { audienceTtsCharacters: 25_000 }
    const error = await attempt('free', 'audience', false)
    expect(error?.message).toBe('Narration isn’t available for this slide yet.')
    expect(error?.message).not.toMatch(/plan|billing|allowance|upgrade/i)
  })

  it('lets the cheapest tier use a premium voice', async () => {
    // Every plan offers every voice; Free simply gets fewer premium characters
    // than Pro does. A tier boundary must not read as "voice unavailable".
    expect(await attempt('free', 'author', true)).toBeNull()
  })

  it('spends the premium allowance separately from the standard one', async () => {
    // Standard exhausted, premium untouched: a premium voice still works,
    // because the two allowances are independent budgets.
    used = { ttsCharacters: 60_000 }
    expect(await attempt('free', 'author', true)).toBeNull()
    expect((await attempt('free', 'author', false))?.metric).toBe(
      'ttsCharacters',
    )
  })

  it('refuses an author who has spent their premium allowance', async () => {
    used = { ttsPremiumCharacters: 100_000 }
    const error = await attempt('pro', 'author', true)
    expect(error?.metric).toBe('ttsPremiumCharacters')
    expect(error?.message).toMatch(/premium narration/i)
  })

  it('blocks premium audience work on the owner’s premium allowance too', async () => {
    // The audience pool pays, but premium remains the owner's capability — so
    // an exhausted premium allowance stops it even with audience characters
    // to spare.
    used = { ttsPremiumCharacters: 100_000, audienceTtsCharacters: 0 }
    const error = await attempt('pro', 'audience', true)
    expect(error?.metric).toBe('ttsPremiumCharacters')
    // Still viewer-safe, despite being a premium-allowance failure.
    expect(error?.message).toBe('Narration isn’t available for this slide yet.')
  })

  it('never blocks a tier whose allowance is unlimited', async () => {
    used = { ttsCharacters: 10 ** 9, audienceTtsCharacters: 10 ** 9 }
    expect(await attempt('max', 'author', false)).toBeNull()
    expect(await attempt('max', 'audience', false)).toBeNull()
  })
})
