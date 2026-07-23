/**
 * Serializes a generated QuizDefinition (SPEC QUIZ-1/QUIZ-7) into the YAML
 * format the separate Quiz Generator library consumes
 * (github.com/bloombar/google-forms-quiz-generator, YAML_FORMAT.md). Each
 * internal question maps to the matching library type: single_choice /
 * multiple_choice (with isCorrect options), short_text / long_text (with
 * optional correctAnswers).
 *
 * Output is produced with the `yaml` library (never hand-built) so it is
 * always valid and parses cleanly in the Quiz Generator. Object keys are
 * written in the library's documented order.
 */
import YAML from 'yaml'
import type { QuizDefinition, QuizQuestion } from '@slide-machine/shared'

/** How the published form collects respondent emails (library field). */
export type EmailCollection = 'verified' | 'responder_input' | 'none'

export interface QuizYamlOptions {
  /** Email-collection mode for the form. Default 'verified' (SPEC QUIZ-2). */
  emailCollection?: EmailCollection
  /** false = ungraded survey. Default true (a graded exit-ticket quiz). */
  isQuiz?: boolean
  /** Points for a question that carries none of its own. Default 1. */
  defaultPoints?: number
}

/** The library's per-option shape: text plus an optional correctness flag. */
interface YamlOption {
  value: string
  isCorrect?: boolean
}

/** The library's per-question shape (fields vary by type). */
interface YamlQuestion {
  title: string
  type: QuizQuestion['type']
  points: number
  options?: YamlOption[]
  correctAnswers?: string[]
}

/** The library's top-level quiz document shape. */
interface YamlQuiz {
  version: 1
  title: string
  description?: string
  isQuiz: boolean
  emailCollection: EmailCollection
  questions: YamlQuestion[]
}

/** Maps one internal question to its library YAML shape, validating per type. */
const toYamlQuestion = (
  q: QuizQuestion,
  i: number,
  defaultPoints: number,
): YamlQuestion => {
  const base = { title: q.question, points: q.points ?? defaultPoints }
  const choices = q.choices ?? []

  switch (q.type) {
    case 'single_choice': {
      if (choices.length < 2) {
        throw new Error(`Question ${i + 1} has fewer than two choices`)
      }
      const correctIndex = q.correctIndex
      if (
        correctIndex === undefined ||
        correctIndex < 0 ||
        correctIndex >= choices.length
      ) {
        throw new Error(`Question ${i + 1} has an out-of-range correctIndex`)
      }
      return {
        ...base,
        type: 'single_choice',
        options: choices.map((value, idx) =>
          idx === correctIndex ? { value, isCorrect: true } : { value },
        ),
      }
    }
    case 'multiple_choice': {
      if (choices.length < 2) {
        throw new Error(`Question ${i + 1} has fewer than two choices`)
      }
      const correct = new Set(q.correctIndexes ?? [])
      if (
        correct.size === 0 ||
        [...correct].some(idx => idx < 0 || idx >= choices.length)
      ) {
        throw new Error(`Question ${i + 1} has invalid correctIndexes`)
      }
      return {
        ...base,
        type: 'multiple_choice',
        options: choices.map((value, idx) =>
          correct.has(idx) ? { value, isCorrect: true } : { value },
        ),
      }
    }
    case 'short_text':
    case 'long_text': {
      const answers = (q.correctAnswers ?? [])
        .map(a => a.trim())
        .filter(Boolean)
      return {
        ...base,
        type: q.type,
        ...(answers.length ? { correctAnswers: answers } : {}),
      }
    }
  }
}

/**
 * Builds the library-compatible quiz object. Throws on a definition that could
 * not produce a valid form (no questions, or a choice question with too few
 * choices / a bad correct index) so a malformed quiz fails loudly here instead
 * of at publish time.
 */
export const toQuizYamlObject = (
  def: QuizDefinition,
  options: QuizYamlOptions = {},
): YamlQuiz => {
  if (def.questions.length === 0) {
    throw new Error('Quiz has no questions')
  }
  const defaultPoints = options.defaultPoints ?? 1

  const questions = def.questions.map((q, i) =>
    toYamlQuestion(q, i, defaultPoints),
  )

  return {
    version: 1,
    title: def.title,
    ...(def.description ? { description: def.description } : {}),
    isQuiz: options.isQuiz ?? true,
    emailCollection: options.emailCollection ?? 'verified',
    questions,
  }
}

/** Serializes a QuizDefinition to a Quiz-Generator-compatible YAML string. */
export const toQuizYaml = (
  def: QuizDefinition,
  options: QuizYamlOptions = {},
): string => YAML.stringify(toQuizYamlObject(def, options))
