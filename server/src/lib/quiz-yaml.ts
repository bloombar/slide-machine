/**
 * Serializes a generated QuizDefinition (SPEC QUIZ-1) into the YAML format
 * the separate Quiz Generator library consumes
 * (github.com/bloombar/google-forms-quiz-generator, YAML_FORMAT.md). The
 * internal model holds single-correct multiple-choice questions, so each
 * maps to the library's `single_choice` type with one `isCorrect` option.
 *
 * Output is produced with the `yaml` library (never hand-built) so it is
 * always valid and parses cleanly in the Quiz Generator. Object keys are
 * written in the library's documented order.
 */
import YAML from 'yaml'
import type { QuizDefinition } from '@slide-machine/shared'

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

/** The library's per-question shape for a single-choice question. */
interface YamlQuestion {
  title: string
  type: 'single_choice'
  points: number
  options: YamlOption[]
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

/**
 * Builds the library-compatible quiz object. Throws on a definition that
 * could not produce a valid form — no questions, a question with fewer than
 * two choices, or a correctIndex outside its choices — so a malformed quiz
 * fails loudly here instead of at publish time.
 */
export const toQuizYamlObject = (
  def: QuizDefinition,
  options: QuizYamlOptions = {},
): YamlQuiz => {
  if (def.questions.length === 0) {
    throw new Error('Quiz has no questions')
  }
  const defaultPoints = options.defaultPoints ?? 1

  const questions = def.questions.map((q, i): YamlQuestion => {
    if (q.choices.length < 2) {
      throw new Error(`Question ${i + 1} has fewer than two choices`)
    }
    if (q.correctIndex < 0 || q.correctIndex >= q.choices.length) {
      throw new Error(`Question ${i + 1} has an out-of-range correctIndex`)
    }
    return {
      title: q.question,
      type: 'single_choice',
      points: q.points ?? defaultPoints,
      options: q.choices.map((value, idx) =>
        idx === q.correctIndex ? { value, isCorrect: true } : { value },
      ),
    }
  })

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
