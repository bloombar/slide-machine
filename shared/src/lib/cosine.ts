/**
 * Cosine similarity for embedding vectors, used by the refine remap to score a
 * stroke's stored phrase against candidate phrases of the rewritten transcript
 * (WB-2). Pure and dependency-free so it runs anywhere and is unit-testable.
 */

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for a
 * length mismatch or a zero-magnitude vector (no meaningful direction), so a
 * degenerate embedding never spuriously "matches".
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    magA += x * x
    magB += y * y
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}
