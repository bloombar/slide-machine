/**
 * Deterministic mock QuizGenerationProvider (SPEC QUIZ-1, mock-first). Lets
 * the quiz pipeline and YAML serialization be built and tested before AI
 * credentials exist; swapping in Gemini is a config change
 * (QUIZ_PROVIDER=gemini), not a rewrite. Makes NO AI calls.
 *
 * Heuristics (documented so tests can rely on them):
 * - One question is sourced from each slide that has any text, up to
 *   `questionCount` (default: one per eligible slide).
 * - The correct answer is the slide's first non-title fragment (body or a
 *   bullet), falling back to its title.
 * - Distractors are the correct fragments of other slides, padded with
 *   "None of the above" / "All of the above" when there are too few.
 * - The correct choice is placed at index `i % choices.length`, so its
 *   position varies deterministically across questions.
 * - Throws when no slide carries any text (nothing to quiz on).
 */
import type {
  QuizDefinition,
  QuizGenerationProvider,
  QuizGenerationRequest,
  QuizQuestion,
  SlideTextContent,
} from '@slide-machine/shared'
import { registry } from './registry'

const GENERIC_DISTRACTORS = ['None of the above', 'All of the above']

/** The non-empty text fragments of a slide, title first. */
const fragmentsOf = (s: SlideTextContent): string[] => {
  const parts: string[] = []
  if (s.title?.trim()) parts.push(s.title.trim())
  if (s.body?.trim()) parts.push(s.body.trim())
  for (const b of s.bullets ?? []) if (b.trim()) parts.push(b.trim())
  return parts
}

const eq = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/** Builds up to `count` distinct distractors for `correct`, padding with
 * generic options so every question offers at least three choices. */
const distractorsFor = (
  correct: string,
  pool: string[],
  count: number,
): string[] => {
  const chosen: string[] = []
  for (const candidate of [...pool, ...GENERIC_DISTRACTORS]) {
    if (chosen.length >= count) break
    if (eq(candidate, correct)) continue
    if (chosen.some(c => eq(c, candidate))) continue
    chosen.push(candidate)
  }
  return chosen
}

export class MockQuizProvider implements QuizGenerationProvider {
  readonly name = 'mock'

  async generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition> {
    const eligible = request.slides
      .map(s => ({ slide: s, fragments: fragmentsOf(s) }))
      .filter(e => e.fragments.length > 0)

    if (eligible.length === 0) {
      throw new Error('No slide text to generate a quiz from')
    }

    // Each slide's "answer" fragment: prefer a detail over the bare title.
    const answers = eligible.map(
      e =>
        e.fragments.find(f => f !== e.slide.title?.trim()) ?? e.fragments[0]!,
    )

    const target = Math.min(
      eligible.length,
      Math.max(1, request.questionCount ?? eligible.length),
    )

    const questions: QuizQuestion[] = []
    for (let i = 0; i < target; i++) {
      const { slide } = eligible[i]!
      const correct = answers[i]!
      const subject = slide.title?.trim()
      const question =
        subject && !eq(subject, correct)
          ? `Which of the following relates to "${subject}"?`
          : 'Which topic did this lecture cover?'

      const pool = answers.filter((_, j) => j !== i)
      const distractors = distractorsFor(correct, pool, 2)
      const choices = [correct, ...distractors]
      // Deterministically vary the correct answer's position.
      const correctIndex = i % choices.length
      ;[choices[0], choices[correctIndex]] = [
        choices[correctIndex]!,
        choices[0]!,
      ]

      questions.push({ question, choices, correctIndex, points: 1 })
    }

    const topic = eligible[0]!.slide.title?.trim()
    return {
      title: topic ? `Exit Ticket: ${topic}` : 'Lecture Exit Ticket',
      description: 'Auto-generated comprehension check.',
      questions,
    }
  }
}

registry.register('quizGeneration', 'mock', () => new MockQuizProvider())
