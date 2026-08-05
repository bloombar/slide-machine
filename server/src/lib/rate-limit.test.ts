/**
 * Unit tests for the fixed-window rate limiter: it counts per key, reopens
 * the window once it has passed, and forgets closed windows so the map does
 * not grow with every caller it has ever seen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRateLimiter } from './rate-limit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createRateLimiter', () => {
  it('allows up to the limit, then refuses', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 })
    expect([1, 2, 3].map(() => limiter.take('a'))).toEqual([true, true, true])
    expect(limiter.take('a')).toBe(false)
  })

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('b')).toBe(true)
    expect(limiter.take('a')).toBe(false)
  })

  it('reopens the window once it has passed', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(limiter.take('a')).toBe(true)
  })

  // Every caller is a key, so windows that have closed have to go: otherwise
  // the guard against abuse is itself a way to grow the process's memory.
  it('forgets closed windows', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })
    for (let i = 0; i < 100; i += 1) limiter.take(`caller-${i}`)
    vi.advanceTimersByTime(1001)
    // The next call prunes; the earlier keys are gone, so each is allowed
    // again as if never seen.
    expect(limiter.take('caller-0')).toBe(true)
    expect(limiter.take('caller-0')).toBe(false)
  })

  it('forgets everything on reset', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })
    expect(limiter.take('a')).toBe(true)
    limiter.reset()
    expect(limiter.take('a')).toBe(true)
  })
})
