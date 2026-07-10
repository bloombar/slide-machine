/**
 * Quiz data models (SPEC §15, §17). The Quiz Generator is a separate
 * service; QuizRef links a deck to the artifact it published.
 */

/** A single generated exit-ticket question; shape follows the Quiz Generator's YAML format. */
export interface QuizQuestion {
  question: string
  choices: string[]
  correctIndex: number
  points?: number
}

/** A generated quiz definition, ready for review and publishing (QUIZ-1). */
export interface QuizDefinition {
  title: string
  description?: string
  questions: QuizQuestion[]
}

/** Instructor-controlled publish options sent with the quiz YAML (QUIZ-2). */
export interface QuizPublishConfig {
  authMode: 'open' | 'domain-restricted' | 'verified-email'
  defaultPoints: number
  driveFolderId?: string
  title: string
}

/** Link to the external Quiz Generator artifact for a deck (QUIZ-3). */
export interface QuizRef {
  id: string
  deckId: string
  quizGeneratorId: string
  formUrl: string
  status: string
  publishConfig: QuizPublishConfig
}
