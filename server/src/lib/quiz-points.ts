/**
 * Equal points splitting for a quiz (QUIZ-7). Given a total and a question
 * count, every question gets the same whole-number share; any indivisible
 * remainder is handed to the first few questions so the parts still sum to the
 * total (e.g. 10 over 3 → [4, 3, 3]). With no total, each question is worth 1.
 * Used by both the mock provider and the publish action so live (Gemini) and
 * mock quizzes divide points identically.
 */
export const splitPointsEqually = (n: number, total?: number): number[] => {
  if (n <= 0) return []
  if (!total || total <= 0) return Array<number>(n).fill(1)
  const base = Math.max(1, Math.floor(total / n))
  const remainder = Math.max(0, total - base * n)
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}
