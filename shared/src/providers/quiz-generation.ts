/**
 * QuizGenerationProvider — slide text in, exit-ticket quiz definition out
 * (SPEC QUIZ-1 / TECH-8). Publishing is handled by the imported Quiz
 * Generator library (in-process); this capability only authors the definition.
 */
import type { QuizDefinition, QuizQuestionCounts } from '../types/quiz'

/** De-identified slide text used as quiz source material (P-2). */
export interface SlideTextContent {
  title?: string
  body?: string
  bullets?: string[]
}

export interface QuizGenerationRequest {
  slides: SlideTextContent[]
  questionCount?: number
  /**
   * The lecture's spoken transcript, included as extra source material only
   * when the instructor opts in (QUIZ-5). Absent = quiz from slides alone.
   */
  transcript?: string
  /**
   * Question stems from previously generated (and since deleted/regenerated)
   * quizzes. Providers must avoid repeating these so a "Regenerate" yields a
   * genuinely different quiz (QUIZ-6).
   */
  avoidQuestions?: string[]
  /**
   * How many questions of each type to produce (QUIZ-7). When given, its total
   * is the number of questions (overriding questionCount); absent = all
   * single_choice up to questionCount.
   */
  typeCounts?: QuizQuestionCounts
  /**
   * Total points to spread across the quiz (QUIZ-7). Each question gets a whole
   * share; absent = the provider's default (1 point each).
   */
  totalPoints?: number
  /**
   * Free-text instructions from the instructor to steer generation (QUIZ-7):
   * topics to focus on or avoid, difficulty, phrasing, etc.
   */
  customInstructions?: string
}

export interface QuizGenerationProvider {
  readonly name: string
  generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition>
}
