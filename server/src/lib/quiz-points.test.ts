/**
 * Unit tests for equal points splitting (QUIZ-7): divisible totals split
 * evenly, indivisible ones hand the remainder to the first questions, and the
 * parts always sum to the total with each question worth at least one point.
 */
import { describe, it, expect } from 'vitest'
import { splitPointsEqually } from './quiz-points'

describe('splitPointsEqually', () => {
  it('defaults to 1 point each when no total is given', () => {
    expect(splitPointsEqually(3)).toEqual([1, 1, 1])
    expect(splitPointsEqually(2, 0)).toEqual([1, 1])
  })

  it('splits an evenly divisible total equally', () => {
    expect(splitPointsEqually(4, 8)).toEqual([2, 2, 2, 2])
  })

  it('hands an indivisible remainder to the first questions', () => {
    expect(splitPointsEqually(3, 10)).toEqual([4, 3, 3])
    expect(splitPointsEqually(3, 5)).toEqual([2, 2, 1])
  })

  it('always sums to the total (when total ≥ count) with each ≥ 1', () => {
    for (const [n, total] of [
      [3, 10],
      [4, 7],
      [5, 5],
      [2, 9],
    ] as const) {
      const pts = splitPointsEqually(n, total)
      expect(pts).toHaveLength(n)
      expect(pts.reduce((a, b) => a + b, 0)).toBe(total)
      for (const p of pts) expect(p).toBeGreaterThanOrEqual(1)
    }
  })

  it('gives each question a floor of 1 even when the total is too small', () => {
    // 2 points cannot cover 5 questions at ≥1 each; each still gets 1
    expect(splitPointsEqually(5, 2)).toEqual([1, 1, 1, 1, 1])
  })

  it('returns an empty array for no questions', () => {
    expect(splitPointsEqually(0, 10)).toEqual([])
  })
})
