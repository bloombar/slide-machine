/**
 * Unit tests for the usage presentation rules (BILL-4): what counts as close
 * to a limit, what counts as spent, and which call to action a tier gets.
 * These decide what a user is told, so they are pinned here rather than
 * inferred from a rendered component.
 */
import { describe, it, expect } from 'vitest'
import type { UsageMetricSummary } from '@slide-machine/shared'
import { approachingLimits, callToActionFor, isExhausted } from './usage'

const metric = (
  over: Partial<UsageMetricSummary> = {},
): UsageMetricSummary => ({
  metric: 'aiTokens',
  used: 0,
  cap: 100,
  fraction: 0,
  allowance: 'instructor',
  unit: 'tokens',
  gauge: false,
  ...over,
})

describe('approachingLimits', () => {
  it('keeps only what has crossed the warning threshold', () => {
    const close = approachingLimits([
      metric({ metric: 'aiTokens', fraction: 0.79 }),
      metric({ metric: 'sttMinutes', fraction: 0.8 }),
      metric({ metric: 'exports', fraction: 0.95 }),
    ])

    // 0.8 is the threshold, so it is included — the same boundary BILL-8
    // notifies on, so the app never emails about what it is not showing.
    expect(close.map(m => m.metric)).toEqual(['exports', 'sttMinutes'])
  })

  it('orders the worst first', () => {
    const close = approachingLimits([
      metric({ metric: 'sttMinutes', fraction: 0.85 }),
      metric({ metric: 'exports', fraction: 1 }),
      metric({ metric: 'aiTokens', fraction: 0.9 }),
    ])

    expect(close.map(m => m.metric)).toEqual([
      'exports',
      'aiTokens',
      'sttMinutes',
    ])
  })

  it('never flags an unlimited metric', () => {
    // There is nothing to run out of, so no amount of use is "close".
    const close = approachingLimits([
      metric({ cap: null, fraction: null, used: 10 ** 9 }),
    ])

    expect(close).toEqual([])
  })

  it('says nothing when everything is comfortable', () => {
    expect(approachingLimits([metric({ fraction: 0.1 })])).toEqual([])
  })
})

describe('isExhausted', () => {
  it('is true only once the allowance is fully spent', () => {
    expect(isExhausted(metric({ fraction: 0.99 }))).toBe(false)
    expect(isExhausted(metric({ fraction: 1 }))).toBe(true)
  })

  it('is false for an unlimited metric', () => {
    expect(isExhausted(metric({ cap: null, fraction: null }))).toBe(false)
  })
})

describe('callToActionFor', () => {
  it('offers an upgrade on every tier that has one above it', () => {
    expect(callToActionFor('free')).toBe('upgrade')
    expect(callToActionFor('fresh')).toBe('upgrade')
    expect(callToActionFor('pro')).toBe('upgrade')
  })

  it('invites Max to get in touch instead', () => {
    // There is no plan above Max, so an upgrade prompt would send the user
    // looking for a page that cannot exist (BILL-5).
    expect(callToActionFor('max')).toBe('contact')
  })
})
