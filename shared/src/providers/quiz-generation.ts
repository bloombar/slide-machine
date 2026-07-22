/**
 * QuizGenerationProvider — slide text in, exit-ticket quiz definition out
 * (SPEC QUIZ-1 / TECH-8). Publishing is handled by the imported Quiz
 * Generator library (in-process); this capability only authors the definition.
 */
import type { QuizDefinition } from '../types/quiz'

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
}

export interface QuizGenerationProvider {
  readonly name: string
  generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition>
}
