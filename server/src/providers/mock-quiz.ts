/**
 * Deterministic mock QuizGenerationProvider (SPEC QUIZ-1, mock-first). Lets
 * the quiz pipeline and YAML serialization be built and tested before AI
 * credentials exist; swapping in Gemini is a config change
 * (QUIZ_PROVIDER=gemini), not a rewrite. Makes NO AI calls.
 *
 * Heuristics (documented so tests can rely on them):
 * - One question is sourced from each slide that has any text, up to
 *   `questionCount` (default: one per eligible slide).
 * - When a transcript is supplied it becomes an extra source "slide", so its
 *   content can seed a question/choice too (QUIZ-5).
 * - The correct answer is the slide's non-title fragment (body or a bullet)
 *   selected by the current round, falling back to its title.
 * - Distractors are the correct fragments of other slides, padded with
 *   "None of the above" / "All of the above" when there are too few.
 * - The correct choice is placed at index `i % choices.length`, so its
 *   position varies deterministically across questions.
 * - `avoidQuestions` drives a "round" that rotates question wording and answer
 *   selection, and no generated question text repeats one in that list — so a
 *   regenerated quiz differs from discarded ones (QUIZ-6).
 * - `typeCounts` sets how many of each type (single/multiple choice, short/long
 *   text); absent = all single_choice. `totalPoints` is split across questions
 *   as whole numbers; absent = 1 each (QUIZ-7).
 * - Throws when no slide carries any text (nothing to quiz on).
 */
import type {
  QuizDefinition,
  QuizGenerationProvider,
  QuizGenerationRequest,
  QuizQuestion,
  QuizQuestionType,
  SlideTextContent,
} from '@slide-machine/shared'
import { registry } from './registry'

const GENERIC_DISTRACTORS = ['None of the above', 'All of the above']

/** Splits `total` points over `n` questions as whole numbers, each ≥ 1
 * (front-loading any remainder). No total → 1 point each. */
const distributePoints = (n: number, total?: number): number[] => {
  if (!total || total <= 0) return Array<number>(n).fill(1)
  const base = Math.max(1, Math.floor(total / n))
  const pts = Array<number>(n).fill(base)
  let remainder = total - base * n
  for (let i = 0; remainder > 0 && i < n; i++) {
    pts[i]!++
    remainder--
  }
  return pts
}

/** The sequence of question types to produce: per-type counts when given
 * (their sum is the total), else `count` single_choice questions. */
const typeSequence = (
  count: number,
  typeCounts?: QuizGenerationRequest['typeCounts'],
): QuizQuestionType[] => {
  const entries = Object.entries(typeCounts ?? {}).filter(
    ([, n]) => (n ?? 0) > 0,
  ) as [QuizQuestionType, number][]
  if (entries.length === 0) {
    return Array<QuizQuestionType>(count).fill('single_choice')
  }
  return entries.flatMap(([type, n]) => Array<QuizQuestionType>(n).fill(type))
}

/** Question templates rotated by round so regeneration reads differently. */
const QUESTION_TEMPLATES: ((subject: string) => string)[] = [
  subject => `Which of the following relates to "${subject}"?`,
  subject => `What did the lecture say about "${subject}"?`,
  subject => `Regarding "${subject}", which statement is correct?`,
]

/** Subject-less fallbacks, likewise rotated by round. */
const GENERIC_QUESTIONS = [
  'Which topic did this lecture cover?',
  'Which of these was discussed in the lecture?',
  'What was a focus of this lecture?',
]

/** The non-empty text fragments of a slide, title first. */
const fragmentsOf = (s: SlideTextContent): string[] => {
  const parts: string[] = []
  if (s.title?.trim()) parts.push(s.title.trim())
  if (s.body?.trim()) parts.push(s.body.trim())
  for (const b of s.bullets ?? []) if (b.trim()) parts.push(b.trim())
  return parts
}

/**
 * Turns the spoken transcript into a synthetic source slide so its content can
 * seed a question. The first sentence becomes the body and the next two become
 * bullets, giving a few distinct fragments to quiz on.
 */
const transcriptSlide = (transcript: string): SlideTextContent => {
  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
  return {
    title: 'Lecture discussion',
    body: sentences[0],
    bullets: sentences.slice(1, 3),
  }
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

/**
 * Chooses a question stem for a slide, starting at the round-shifted template
 * and stepping forward until it lands on wording not already in `avoid`. This
 * guarantees a regenerated quiz does not repeat a discarded question when any
 * non-colliding wording exists.
 */
const pickQuestionText = (
  subject: string | undefined,
  correct: string,
  offset: number,
  avoid: Set<string>,
): string => {
  const options: string[] =
    subject && !eq(subject, correct)
      ? QUESTION_TEMPLATES.map(t => t(subject))
      : GENERIC_QUESTIONS
  for (let k = 0; k < options.length; k++) {
    const text = options[(offset + k) % options.length]!
    if (!avoid.has(text.toLowerCase())) return text
  }
  // Every wording collides — accept a repeat rather than fail.
  return options[offset % options.length]!
}

export class MockQuizProvider implements QuizGenerationProvider {
  readonly name = 'mock'

  async generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition> {
    // Slides plus, when opted in, a synthetic slide built from the transcript.
    const sources = [...request.slides]
    if (request.transcript?.trim()) {
      sources.push(transcriptSlide(request.transcript))
    }

    const eligible = sources
      .map(s => ({ slide: s, fragments: fragmentsOf(s) }))
      .filter(e => e.fragments.length > 0)

    if (eligible.length === 0) {
      throw new Error('No slide text to generate a quiz from')
    }

    // A "round" derived from how many prior questions to avoid: it rotates the
    // wording and the chosen answer so each regeneration differs (QUIZ-6).
    const round = request.avoidQuestions?.length ?? 0
    const avoid = new Set(
      (request.avoidQuestions ?? []).map(q => q.trim().toLowerCase()),
    )

    // Each slide's "answer" fragment: prefer a detail over the bare title,
    // rotating which detail by the round.
    const answers = eligible.map(e => {
      const details = e.fragments.filter(f => f !== e.slide.title?.trim())
      const pick = details.length ? details : e.fragments
      return pick[round % pick.length]!
    })

    // The default count is one question per eligible slide (clamped by
    // questionCount); per-type counts override the total.
    const defaultCount = Math.min(
      eligible.length,
      Math.max(1, request.questionCount ?? eligible.length),
    )
    const types = typeSequence(defaultCount, request.typeCounts)
    const points = distributePoints(types.length, request.totalPoints)

    const questions: QuizQuestion[] = types.map((type, i) => {
      const src = i % eligible.length
      const { slide } = eligible[src]!
      const correct = answers[src]!
      const subject = slide.title?.trim()
      const pts = points[i]!

      if (type === 'single_choice') {
        // Pick the first template whose text does not repeat an avoided
        // question, starting from the round-shifted position.
        const question = pickQuestionText(subject, correct, i + round, avoid)
        const pool = answers.filter((_, j) => j !== src)
        const distractors = distractorsFor(correct, pool, 2)
        const choices = [correct, ...distractors]
        // Deterministically vary the correct answer's position.
        const correctIndex = i % choices.length
        ;[choices[0], choices[correctIndex]] = [
          choices[correctIndex]!,
          choices[0]!,
        ]
        return { type, question, choices, correctIndex, points: pts }
      }

      if (type === 'multiple_choice') {
        const second = answers[(src + 1) % eligible.length]!
        const corrects = eq(second, correct) ? [correct] : [correct, second]
        const pool = answers.filter(
          (_, j) => j !== src && !eq(answers[j]!, second),
        )
        const distractors = distractorsFor(
          correct,
          pool,
          Math.max(2, 4 - corrects.length),
        )
        const choices = [...corrects, ...distractors]
        const correctIndexes = corrects.map((_, idx) => idx)
        const question = subject
          ? `Select everything that applies to "${subject}".`
          : 'Select everything that was discussed in this lecture.'
        return { type, question, choices, correctIndexes, points: pts }
      }

      if (type === 'short_text') {
        const question = subject
          ? `In a few words, what does the lecture say about "${subject}"?`
          : 'In a few words, what did this lecture cover?'
        return { type, question, correctAnswers: [correct], points: pts }
      }

      // long_text
      const question = subject
        ? `Explain "${subject}" in your own words.`
        : 'Summarize this lecture in your own words.'
      return { type, question, points: pts }
    })

    const topic = eligible[0]!.slide.title?.trim()
    return {
      title: topic ? `Exit Ticket: ${topic}` : 'Lecture Exit Ticket',
      description: 'Auto-generated comprehension check.',
      questions,
    }
  }
}

registry.register('quizGeneration', 'mock', () => new MockQuizProvider())
