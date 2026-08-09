/**
 * Unit tests for what a metered event costs (BILL-6/BILL-7).
 *
 * Against the real `config/service-prices.json`, deliberately: the rates are
 * the artifact the cost model derives the caps from, and a test that invents
 * its own would pass while the shipped numbers were wrong. What is asserted is
 * therefore relationships and shapes — output costs more than input, a cache
 * hit costs nothing — rather than particular figures that a vendor's price
 * change should be allowed to move.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { costMicrosFor, MICROS_PER_UNIT, resetPriceCache } from './pricing'

beforeEach(resetPriceCache)

describe('AI tokens', () => {
  it('prices input and output at their own rates when told the split', () => {
    const mostlyInput = costMicrosFor('aiTokens', 1_000_000, {
      kind: 'tokens',
      inputTokens: 900_000,
      outputTokens: 100_000,
    })
    const mostlyOutput = costMicrosFor('aiTokens', 1_000_000, {
      kind: 'tokens',
      inputTokens: 100_000,
      outputTokens: 900_000,
    })
    // Same token count, very different bill. This is the whole reason the
    // adapter passes a hint rather than letting the metric speak for itself.
    expect(mostlyOutput).toBeGreaterThan(mostlyInput)
  })

  it('assumes the dearer rate when it is told nothing', () => {
    // Overstating is the right direction for a figure an operator uses to
    // decide what the deployment costs: a report that flatters is worse.
    const blind = costMicrosFor('aiTokens', 1_000_000)
    const allOutput = costMicrosFor('aiTokens', 1_000_000, {
      kind: 'tokens',
      outputTokens: 1_000_000,
    })
    expect(blind).toBe(allOutput)
  })

  it('scales linearly with the token count', () => {
    const one = costMicrosFor('aiTokens', 1_000_000)
    expect(costMicrosFor('aiTokens', 2_000_000)).toBe(one * 2)
  })

  it('falls back to the default model for one it does not know', () => {
    // A newly-switched model must still price rather than throw mid-call.
    expect(
      costMicrosFor('aiTokens', 1_000_000, {
        kind: 'tokens',
        model: 'gemini-not-a-real-model',
      }),
    ).toBe(costMicrosFor('aiTokens', 1_000_000))
  })
})

describe('the other metered services', () => {
  it('prices recorded minutes', () => {
    expect(costMicrosFor('sttMinutes', 60)).toBeGreaterThan(0)
  })

  it('prices narration, and premium above standard', () => {
    const standard = costMicrosFor('ttsCharacters', 1_000_000)
    const premium = costMicrosFor('ttsPremiumCharacters', 1_000_000)
    expect(standard).toBeGreaterThan(0)
    expect(premium).toBeGreaterThan(standard)
  })

  it('prices a viewer’s narration at the same rate as the owner’s', () => {
    // Which allowance paid is a fact about the plan; what it cost us is a fact
    // about the vendor, and the vendor charges the same either way.
    expect(costMicrosFor('audienceTtsCharacters', 1_000_000)).toBe(
      costMicrosFor('ttsCharacters', 1_000_000),
    )
  })

  it('prices translated characters', () => {
    expect(costMicrosFor('translationCharacters', 1_000_000)).toBeGreaterThan(0)
  })

  it('does not double-count a translated language', () => {
    // `audienceLocales` counts whole languages so the allowance reads well
    // (BILL-3). The characters behind it are priced on the
    // `translationCharacters` event for the same work.
    expect(costMicrosFor('audienceLocales', 3)).toBe(0)
  })

  it.each(['imageLookups', 'importMb', 'exports'] as const)(
    'records %s at zero — metered to bound it, not because it is invoiced',
    metric => {
      expect(costMicrosFor(metric, 100)).toBe(0)
    },
  )
})

describe('arithmetic', () => {
  it('costs nothing for nothing', () => {
    expect(costMicrosFor('aiTokens', 0)).toBe(0)
    expect(costMicrosFor('sttMinutes', -5)).toBe(0)
  })

  it('keeps a single token’s cost above zero', () => {
    // The reason the ledger is in micros: in cents, almost every event in the
    // product would round to nothing and a million of them would sum to it.
    const perMillion = costMicrosFor('aiTokens', 1_000_000)
    expect(perMillion).toBeGreaterThan(0)
    expect(costMicrosFor('aiTokens', 10_000)).toBeGreaterThan(0)
  })

  it('returns whole micros', () => {
    const cost = costMicrosFor('aiTokens', 12_345)
    expect(Number.isInteger(cost)).toBe(true)
  })

  it('denominates in millionths of a currency unit', () => {
    expect(MICROS_PER_UNIT).toBe(1_000_000)
  })
})
