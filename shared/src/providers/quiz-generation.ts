/**
 * QuizGenerationProvider — slide text in, exit-ticket quiz definition out
 * (SPEC QUIZ-1 / TECH-8). Publishing is handled by the separate Quiz
 * Generator service; this capability only authors the definition.
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
}

export interface QuizGenerationProvider {
  readonly name: string
  generateQuiz(request: QuizGenerationRequest): Promise<QuizDefinition>
}
