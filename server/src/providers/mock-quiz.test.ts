/**
 * Unit tests for the deterministic mock quiz provider: one valid
 * single-correct question per eligible slide, correct-answer selection and
 * placement, distractor padding, questionCount clamping, and the throw on
 * contentless input. Every produced question must be serializable.
 */
import { describe, it, expect } from 'vitest'
import type { QuizGenerationRequest } from '@slide-machine/shared'
import { MockQuizProvider } from './mock-quiz'
import { toQuizYamlObject } from '../lib/quiz-yaml'

const provider = new MockQuizProvider()

const req = (
  over: Partial<QuizGenerationRequest> = {},
): QuizGenerationRequest => ({
  slides: [
    { title: 'Photosynthesis', bullets: ['Occurs in chloroplasts'] },
    { title: 'Respiration', body: 'Releases energy from glucose' },
    { title: 'Cells', bullets: ['Basic unit of life'] },
  ],
  ...over,
})

describe('MockQuizProvider', () => {
  it('produces one valid question per eligible slide by default', async () => {
    const quiz = await provider.generateQuiz(req())
    expect(quiz.questions).toHaveLength(3)
    expect(quiz.title).toBe('Exit Ticket: Photosynthesis')
    for (const q of quiz.questions) {
      expect(q.choices.length).toBeGreaterThanOrEqual(3)
      expect(q.correctIndex).toBeGreaterThanOrEqual(0)
      expect(q.correctIndex).toBeLessThan(q.choices.length)
      expect(q.points).toBe(1)
    }
    // The whole quiz maps cleanly to the library schema
    expect(() => toQuizYamlObject(quiz)).not.toThrow()
  })

  it('uses a slide detail (not the bare title) as the correct answer', async () => {
    const quiz = await provider.generateQuiz(req())
    const q1 = quiz.questions[0]!
    expect(q1.choices[q1.correctIndex]).toBe('Occurs in chloroplasts')
  })

  it('places the correct answer at index i % choices.length', async () => {
    const quiz = await provider.generateQuiz(req())
    // Q0 -> index 0, Q1 -> index 1, Q2 -> index 2 (three choices each)
    expect(quiz.questions[0]!.correctIndex).toBe(0)
    expect(quiz.questions[1]!.correctIndex).toBe(1)
    expect(quiz.questions[2]!.correctIndex).toBe(2)
  })

  it('clamps questionCount to at least one and at most the eligible count', async () => {
    expect(
      (await provider.generateQuiz(req({ questionCount: 2 }))).questions,
    ).toHaveLength(2)
    // More than available -> capped at the number of eligible slides
    expect(
      (await provider.generateQuiz(req({ questionCount: 99 }))).questions,
    ).toHaveLength(3)
    // Zero/negative -> at least one
    expect(
      (await provider.generateQuiz(req({ questionCount: 0 }))).questions,
    ).toHaveLength(1)
  })

  it('pads with generic distractors when few other slides exist', async () => {
    const quiz = await provider.generateQuiz(
      req({ slides: [{ title: 'Alone', bullets: ['The only detail'] }] }),
    )
    const q = quiz.questions[0]!
    expect(q.choices).toContain('The only detail')
    expect(q.choices).toContain('None of the above')
    expect(q.choices).toContain('All of the above')
  })

  it('falls back to a title-only quiz and generic title', async () => {
    const quiz = await provider.generateQuiz(
      req({ slides: [{ title: 'Only Title' }] }),
    )
    const q = quiz.questions[0]!
    // With only a title, it becomes both subject and answer
    expect(q.choices).toContain('Only Title')
    expect(q.question).toBe('Which topic did this lecture cover?')
  })

  it('throws when no slide carries any text', async () => {
    await expect(
      provider.generateQuiz(req({ slides: [{ title: ' ' }, {}] })),
    ).rejects.toThrow(/No slide text/)
  })

  it('skips blank bullets and de-duplicates shared distractors', async () => {
    const quiz = await provider.generateQuiz(
      req({
        slides: [
          { title: 'One', bullets: ['X detail', '  '] },
          { title: 'Two', bullets: ['Y detail'] },
          { title: 'Three', bullets: ['Y detail'] },
        ],
      }),
    )
    const q0 = quiz.questions[0]!
    expect(q0.choices).toContain('X detail')
    // The two slides sharing "Y detail" contribute it only once
    expect(q0.choices.filter(c => c === 'Y detail')).toHaveLength(1)
    // The blank bullet never becomes a choice
    expect(q0.choices).not.toContain('  ')
  })

  it('uses a generic title when the first slide has no title', async () => {
    const quiz = await provider.generateQuiz(
      req({ slides: [{ body: 'Only body content' }] }),
    )
    expect(quiz.title).toBe('Lecture Exit Ticket')
    expect(quiz.questions[0]!.choices).toContain('Only body content')
  })
})
