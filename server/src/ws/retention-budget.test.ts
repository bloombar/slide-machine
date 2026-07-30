/**
 * Unit tests for the process-wide audio-retention budget: reservations
 * accumulate, an overrun is refused rather than allowed to grow RSS, releases
 * free capacity, and 0 means "no global limit".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Same validated env with a small budget, so the ceiling is easy to reach.
vi.mock('../config/env', async importOriginal => {
  const actual = await importOriginal<typeof import('../config/env')>()
  return {
    ...actual,
    env: { ...actual.env, AUDIO_RETENTION_MAX_TOTAL_MB: 1 },
  }
})

import { env } from '../config/env'
import {
  canStartRetention,
  releaseRetentionBytes,
  reserveRetentionBytes,
  resetRetentionBudget,
  retainedBytesHeld,
} from './retention-budget'

const ONE_MB = 1024 * 1024

/** Budget is read per call, so a test can change it after import. */
const setBudgetMb = (mb: number): void => {
  ;(
    env as { AUDIO_RETENTION_MAX_TOTAL_MB: number }
  ).AUDIO_RETENTION_MAX_TOTAL_MB = mb
}

beforeEach(() => {
  resetRetentionBudget()
  setBudgetMb(1)
})

describe('retention budget', () => {
  it('accumulates reservations up to the ceiling', () => {
    expect(retainedBytesHeld()).toBe(0)
    expect(reserveRetentionBytes(400_000)).toBe(true)
    expect(reserveRetentionBytes(400_000)).toBe(true)
    expect(retainedBytesHeld()).toBe(800_000)
  })

  it('reserves right up to the ceiling but refuses to cross it', () => {
    expect(reserveRetentionBytes(ONE_MB)).toBe(true)
    expect(retainedBytesHeld()).toBe(ONE_MB)
    // Refused reservations must not be counted — that would leak the budget
    // and starve every later session.
    expect(reserveRetentionBytes(1)).toBe(false)
    expect(retainedBytesHeld()).toBe(ONE_MB)
  })

  it('lets a new session start only while capacity remains', () => {
    expect(canStartRetention()).toBe(true)
    reserveRetentionBytes(ONE_MB - 1)
    expect(canStartRetention()).toBe(true)
    reserveRetentionBytes(1)
    // Exactly full: a new session transcribes without retaining.
    expect(canStartRetention()).toBe(false)
  })

  it('frees capacity when a session releases', () => {
    reserveRetentionBytes(ONE_MB)
    expect(canStartRetention()).toBe(false)
    releaseRetentionBytes(ONE_MB)
    expect(retainedBytesHeld()).toBe(0)
    expect(canStartRetention()).toBe(true)
    expect(reserveRetentionBytes(ONE_MB)).toBe(true)
  })

  it('never goes negative on an over-release', () => {
    // A double flush must not mint phantom capacity.
    reserveRetentionBytes(1000)
    releaseRetentionBytes(1000)
    releaseRetentionBytes(1000)
    expect(retainedBytesHeld()).toBe(0)
  })

  it('treats 0 as no global limit', () => {
    setBudgetMb(0)
    expect(reserveRetentionBytes(500 * ONE_MB)).toBe(true)
    expect(reserveRetentionBytes(500 * ONE_MB)).toBe(true)
    expect(canStartRetention()).toBe(true)
  })
})
