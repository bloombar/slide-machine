/**
 * Unit tests for the pure relative-age calculation.
 */
import { describe, it, expect } from 'vitest'
import { timeAgo } from './useTimeAgo'

const NOW = new Date('2026-07-11T12:00:00.000Z').getTime()
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

describe('timeAgo', () => {
  it('covers every unit from seconds to years', () => {
    expect(timeAgo(ago(5), NOW)).toBe('just now')
    expect(timeAgo(ago(45), NOW)).toBe('45 seconds ago')
    expect(timeAgo(ago(90), NOW)).toBe('1 minute ago')
    expect(timeAgo(ago(45 * 60), NOW)).toBe('45 minutes ago')
    expect(timeAgo(ago(3 * 3600), NOW)).toBe('3 hours ago')
    expect(timeAgo(ago(2 * 86400), NOW)).toBe('2 days ago')
    expect(timeAgo(ago(2 * 604800), NOW)).toBe('2 weeks ago')
    expect(timeAgo(ago(3 * 2629800), NOW)).toBe('3 months ago')
    expect(timeAgo(ago(2 * 31557600), NOW)).toBe('2 years ago')
  })

  it('clamps future timestamps to just now', () => {
    expect(timeAgo(ago(-60), NOW)).toBe('just now')
  })
})
