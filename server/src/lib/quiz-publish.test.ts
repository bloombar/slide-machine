/**
 * Unit tests for the mock quiz publisher: it returns a Google-Forms-shaped
 * URL, is deterministic per (quiz, folder), and varies by folder — the
 * contract the real library implementation must also honor.
 */
import { describe, it, expect } from 'vitest'
import type { QuizDefinition } from '@slide-machine/shared'
import { publishQuiz } from './quiz-publish'

const quiz: QuizDefinition = {
  title: 'Photosynthesis',
  questions: [
    {
      type: 'single_choice',
      question: 'Where?',
      choices: ['Chloroplasts', 'Nucleus'],
      correctIndex: 0,
    },
  ],
}

describe('publishQuiz (mock)', () => {
  it('returns a Google-Forms-shaped URL with a mock id', async () => {
    const r = await publishQuiz({ quiz, driveFolderId: 'root' })
    expect(r.formId).toMatch(/^mock-[0-9a-f]{32}$/)
    expect(r.formUrl).toBe(
      `https://docs.google.com/forms/d/e/${r.formId}/viewform`,
    )
  })

  it('is deterministic for the same quiz and folder', async () => {
    const a = await publishQuiz({ quiz, driveFolderId: 'root' })
    const b = await publishQuiz({ quiz, driveFolderId: 'root' })
    expect(a.formUrl).toBe(b.formUrl)
  })

  it('varies by destination folder', async () => {
    const a = await publishQuiz({ quiz, driveFolderId: 'root' })
    const b = await publishQuiz({ quiz, driveFolderId: 'other' })
    expect(a.formUrl).not.toBe(b.formUrl)
  })
})
