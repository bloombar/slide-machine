/**
 * Unit tests for how a translation is charged: which allowance it draws on,
 * when it is refused, and what a blocked reader is told.
 *
 * The read-through caching that decides *whether* any of this runs needs a
 * database and is covered in test/integration/translation.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Caps per tier, mirroring the shipped shape. Free gets a single audience
 * language; Max gets many but never unlimited. */
const CAPS: Record<string, Record<string, number | null>> = {
  free: { translationCharacters: 9_000, audienceLocales: 1 },
  pro: { translationCharacters: 100_000, audienceLocales: 15 },
  // A deployment that switched translation off entirely — the `0` sentinel no
  // shipped tier uses (BILL-1), kept working because "not included" and "used
  // up" have to read differently.
  none: { translationCharacters: 0, audienceLocales: 0 },
}

let used: Record<string, number> = {}
const recorded: { metric: string; quantity: number; billable: boolean }[] = []

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
    recordUsage: async (
      _userId: string,
      metric: string,
      quantity: number,
      { billable = true }: { billable?: boolean } = {},
    ) => {
      recorded.push({ metric, quantity, billable })
    },
  }
})

// The owner lookup is the one thing here that touches the database; the policy
// under test is everything after it.
vi.mock('../models/user', () => ({
  UserModel: {
    findById: (id: string) => ({
      select: () => ({
        catch: async () =>
          id === 'gone' ? null : { planTier: 'free', planGrant: null },
      }),
    }),
  },
}))

const {
  assertTranslationCapacity,
  recordCachedTranslation,
  recordTranslationUsage,
  translationBillingFor,
  translationMetricFor,
} = await import('./translation-usage')
const { PlanLimitExceededError } = await import('./limits')
type PlanLimitError = InstanceType<typeof PlanLimitExceededError>

beforeEach(() => {
  used = {}
  recorded.length = 0
})

/** Runs a check and returns the error it threw, or null when it allowed. */
const attempt = async (
  tier: string,
  actor: 'author' | 'audience',
  localeIsNew = true,
): Promise<PlanLimitError | null> => {
  try {
    await assertTranslationCapacity(
      { ownerId: 'u1', tier: tier as never, actor },
      { localeIsNew },
    )
    return null
  } catch (error) {
    return error as PlanLimitError
  }
}

describe('translationMetricFor', () => {
  it('charges an owner’s translation to the authoring allowance', () => {
    expect(translationMetricFor('author')).toBe('translationCharacters')
  })

  it('charges a reader’s translation to the audience allowance', () => {
    // The separation is the whole point: a deck that finds an audience must
    // not be able to exhaust its author's own budget (BILL-3).
    expect(translationMetricFor('audience')).toBe('audienceLocales')
  })
})

describe('assertTranslationCapacity', () => {
  it('allows an owner with allowance left', async () => {
    used = { translationCharacters: 1_000 }
    expect(await attempt('free', 'author')).toBeNull()
  })

  it('refuses an owner whose translation allowance is spent', async () => {
    used = { translationCharacters: 9_000 }
    const error = await attempt('free', 'author')
    expect(error).toBeInstanceOf(PlanLimitExceededError)
    expect(error?.metric).toBe('translationCharacters')
    expect(error?.message).toMatch(/used all of this billing period/i)
  })

  it('tells an owner a tier without translation is not an exhausted one', async () => {
    const error = await attempt('none', 'author')
    expect(error?.message).toMatch(/not included in your current plan/i)
  })

  it('tells a blocked reader nothing about the owner’s billing', async () => {
    // The viewer-safe rule (BILL-4): a student learns the lecture is not
    // readable in that language, never that their instructor ran out.
    used = { audienceLocales: 1 }
    const error = await attempt('free', 'audience')
    expect(error?.message).toBe(
      'This lecture isn’t available in that language.',
    )
    expect(error?.message).not.toMatch(/plan|billing|allowance|upgrade|cap/i)
  })

  it('does not let an audience request spend the owner’s own allowance', async () => {
    // The owner has nothing left for their own work, but the audience pool is
    // untouched, so a student may still be the first to ask for a language.
    used = { translationCharacters: 9_000 }
    expect(await attempt('free', 'audience')).toBeNull()
  })

  it('does not let the owner’s work be blocked by their audience', async () => {
    used = { audienceLocales: 1 }
    expect(await attempt('free', 'author')).toBeNull()
  })

  it('never refuses a language the deck already has', async () => {
    // A student who arrives after an edit re-translates a lecture that is
    // already published in their language. It is charged nothing, so an
    // exhausted allowance has nothing to refuse.
    used = { audienceLocales: 1 }
    expect(await attempt('free', 'audience', false)).toBeNull()
  })

  it('still refuses an owner on a language the deck already has', async () => {
    // The authoring side is charged by the word, so every call it makes is a
    // call that costs — there is no free re-translation to protect.
    used = { translationCharacters: 9_000 }
    expect(await attempt('free', 'author', false)).toBeInstanceOf(
      PlanLimitExceededError,
    )
  })

  it('gives a larger tier more room on both sides', async () => {
    used = { translationCharacters: 9_000, audienceLocales: 1 }
    expect(await attempt('pro', 'author')).toBeNull()
    expect(await attempt('pro', 'audience')).toBeNull()
  })
})

describe('recordTranslationUsage', () => {
  const author = {
    ownerId: 'u1',
    tier: 'free' as const,
    actor: 'author' as const,
  }
  const audience = {
    ownerId: 'u1',
    tier: 'free' as const,
    actor: 'audience' as const,
  }

  it('charges an owner for the characters submitted', async () => {
    await recordTranslationUsage(author, {
      characters: 1_234,
      localeIsNew: true,
    })
    expect(recorded).toEqual([
      { metric: 'translationCharacters', quantity: 1_234, billable: true },
    ])
  })

  it('charges an owner by length, not by language', async () => {
    // Re-translating an edited deck the owner already translated costs the
    // words it re-sent — there is no "already paid for this language" here.
    await recordTranslationUsage(author, {
      characters: 500,
      localeIsNew: false,
    })
    expect(recorded[0]).toMatchObject({
      metric: 'translationCharacters',
      quantity: 500,
      billable: true,
    })
  })

  it('charges an audience one unit for a language nobody had asked for', async () => {
    await recordTranslationUsage(audience, {
      characters: 50_000,
      localeIsNew: true,
    })
    // One language, whatever the deck's length: that is the promise the
    // allowance makes to the instructor reading their plan.
    expect(recorded).toEqual([
      { metric: 'audienceLocales', quantity: 1, billable: true },
    ])
  })

  it('charges an audience nothing for a language that already existed', async () => {
    await recordTranslationUsage(audience, {
      characters: 50_000,
      localeIsNew: false,
    })
    expect(recorded).toEqual([
      { metric: 'audienceLocales', quantity: 0, billable: false },
    ])
  })
})

describe('recordCachedTranslation', () => {
  it.each([
    ['author', 'translationCharacters'],
    ['audience', 'audienceLocales'],
  ])('records a %s cache hit at zero, never debited', async (actor, metric) => {
    // Counted because the read happened — the number of students who read a
    // deck is the denominator of every per-student average (BILL-7) — but
    // never charged, because serving stored text costs nothing.
    await recordCachedTranslation({
      ownerId: 'u1',
      tier: 'free',
      actor: actor as 'author' | 'audience',
    })
    expect(recorded).toEqual([{ metric, quantity: 0, billable: false }])
  })
})

describe('translationBillingFor', () => {
  it('bills the owner at their effective tier', async () => {
    expect(await translationBillingFor('u1', 'audience')).toEqual({
      ownerId: 'u1',
      tier: 'free',
      actor: 'audience',
    })
  })

  it('bills nobody for a deck whose owner is gone', async () => {
    // There is no allowance to check and no counter to debit, so the
    // translation runs unmetered rather than failing.
    expect(await translationBillingFor('gone', 'author')).toBeUndefined()
  })
})
