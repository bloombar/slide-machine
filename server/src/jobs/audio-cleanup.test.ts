/**
 * Unit tests for how a tier's retention window composes with the deployment's
 * (BILL-3). The rule is "shortest wins", which has to hold in both directions:
 * an operator tightening the window for privacy must not be overridden by a
 * generous tier, and a tier that keeps less must not be loosened by a permissive
 * deployment.
 */
import { describe, it, expect } from 'vitest'
import { effectiveRetentionDays } from './audio-cleanup'

describe('effectiveRetentionDays', () => {
  it('takes the tier’s window when it is the shorter', () => {
    expect(effectiveRetentionDays(7, 30)).toBe(7)
  })

  it('takes the deployment’s window when it is the shorter', () => {
    // An operator who tightens retention for privacy is not undone by a plan
    // that would have kept the audio for three weeks.
    expect(effectiveRetentionDays(21, 3)).toBe(3)
  })

  it('falls back to the deployment when the tier sets no window', () => {
    // `null` on a tier means "adds no bound of its own", not "keep forever" —
    // the deployment's window still governs.
    expect(effectiveRetentionDays(null, 30)).toBe(30)
  })

  it('treats a zero or negative tier window as no bound', () => {
    // The plans schema forbids a negative, but a hand-edited config should
    // degrade to the deployment's window rather than deleting immediately.
    expect(effectiveRetentionDays(0, 30)).toBe(30)
    expect(effectiveRetentionDays(-1, 30)).toBe(30)
  })

  it('is unchanged when both windows agree', () => {
    expect(effectiveRetentionDays(14, 14)).toBe(14)
  })
})
