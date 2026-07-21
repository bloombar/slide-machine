import { describe, expect, it } from 'vitest'
import { anchorFraction, remapAnchor } from './drawing-anchor'

describe('anchorFraction', () => {
  it('returns the proportional position of an offset', () => {
    expect(anchorFraction(50, 100)).toBe(0.5)
    expect(anchorFraction(0, 100)).toBe(0)
    expect(anchorFraction(100, 100)).toBe(1)
  })

  it('guards a zero/negative-length transcript', () => {
    expect(anchorFraction(10, 0)).toBe(0)
    expect(anchorFraction(10, -5)).toBe(0)
  })

  it('clamps out-of-range offsets to [0, 1]', () => {
    expect(anchorFraction(-10, 100)).toBe(0)
    expect(anchorFraction(150, 100)).toBe(1)
  })
})

describe('remapAnchor', () => {
  it('rescales an anchor proportionally to the new length', () => {
    expect(remapAnchor(30, 100, 200)).toBe(60)
    expect(remapAnchor(50, 100, 50)).toBe(25)
  })

  it('rounds to the nearest character', () => {
    expect(remapAnchor(1, 3, 10)).toBe(3) // 3.33 -> 3
    expect(remapAnchor(2, 3, 10)).toBe(7) // 6.67 -> 7
  })

  it('collapses to the start when the old transcript was empty', () => {
    expect(remapAnchor(0, 0, 100)).toBe(0)
    expect(remapAnchor(10, 0, 100)).toBe(0)
  })

  it('keeps endpoints at the boundaries', () => {
    expect(remapAnchor(0, 80, 120)).toBe(0)
    expect(remapAnchor(80, 80, 120)).toBe(120)
  })
})
