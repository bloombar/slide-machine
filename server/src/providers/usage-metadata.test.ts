/**
 * Unit tests for Gemini token accounting. The counts drive a billing cap, so
 * the parsing has to be exact about which fields exist and forgiving about
 * which do not — a response shape we misread is either an unbilled call or a
 * user blocked for spend that never happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { totalTokens, meterGeminiUsage } from './usage-metadata'
import { runWithUsage } from '../billing/usage-context'

vi.mock('../billing/usage', () => ({ recordUsage: vi.fn() }))
const { recordUsage } = await import('../billing/usage')

beforeEach(() => vi.mocked(recordUsage).mockClear())

describe('totalTokens', () => {
  it("prefers Gemini's own total", () => {
    expect(
      totalTokens({
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        totalTokenCount: 130,
      }),
    ).toBe(130)
  })

  it('sums the parts when no total is reported', () => {
    expect(
      totalTokens({ promptTokenCount: 100, candidatesTokenCount: 20 }),
    ).toBe(120)
  })

  it('counts thinking tokens, which bill at the output rate', () => {
    expect(
      totalTokens({
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 500,
      }),
    ).toBe(620)
  })

  it('counts nothing rather than guessing when usage is absent', () => {
    expect(totalTokens(undefined)).toBe(0)
    expect(totalTokens({})).toBe(0)
  })
})

describe('meterGeminiUsage', () => {
  it('meters the response against the ambient user', async () => {
    await runWithUsage('user-1', () =>
      meterGeminiUsage({ totalTokenCount: 2500 }),
    )

    expect(recordUsage).toHaveBeenCalledWith(
      'user-1',
      'aiTokens',
      2500,
      // The cap is charged the combined total; the split rides along only so
      // the cost ledger can price input and output at their own rates.
      expect.objectContaining({
        pricing: expect.objectContaining({ kind: 'tokens' }),
      }),
    )
  })

  it('hands the ledger the input/output split the metric flattens', async () => {
    // `aiTokens` is one allowance, but the two halves bill at different rates
    // (BILL-7). Thinking tokens go with output, which is how Gemini bills them.
    await runWithUsage('user-1', () =>
      meterGeminiUsage({
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 500,
      }),
    )

    expect(recordUsage).toHaveBeenCalledWith('user-1', 'aiTokens', 620, {
      pricing: {
        kind: 'tokens',
        inputTokens: 100,
        outputTokens: 520,
        model: undefined,
      },
    })
  })

  it('is a no-op outside a usage context, so background work is unbilled', async () => {
    await meterGeminiUsage({ totalTokenCount: 2500 })

    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('records nothing when a response reports no usage', async () => {
    await runWithUsage('user-1', () => meterGeminiUsage(undefined))

    expect(recordUsage).not.toHaveBeenCalled()
  })
})
