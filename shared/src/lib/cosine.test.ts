import { describe, expect, it } from 'vitest'
import { cosineSimilarity } from './cosine'

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('ranks a closer vector higher', () => {
    const target = [1, 1, 0]
    const near = cosineSimilarity(target, [1, 1, 0.1])
    const far = cosineSimilarity(target, [1, 0, 0])
    expect(near).toBeGreaterThan(far)
  })

  it('returns 0 on length mismatch or a zero vector', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })
})
