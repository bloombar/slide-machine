/**
 * Quiz data models (SPEC §15, §17). The Quiz Generator is a separate repo
 * imported in-process as a library; QuizRef links a deck to the Google Form
 * it published.
 */

/** A single generated exit-ticket question; shape maps to the imported Quiz Generator library's quiz model. */
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

/** Instructor-controlled publish options sent with the quiz definition (QUIZ-2). */
export interface QuizPublishConfig {
  /**
   * How responses are gated. Note: 'domain-restricted' (NYU-Workspace-only) is
   * not enforceable via the Google Forms REST API and is deferred (SPEC §17);
   * the pilot uses 'verified-email'.
   */
  authMode: 'open' | 'domain-restricted' | 'verified-email'
  defaultPoints: number
  driveFolderId?: string
  title: string
}

/** Link to the published Google Form for a deck (QUIZ-3). */
export interface QuizRef {
  id: string
  deckId: string
  formId: string
  formUrl: string
  status: string
  publishConfig: QuizPublishConfig
}

/** A published quiz as surfaced to the Quiz-tab UI (QUIZ-3). */
export interface PublishedQuiz {
  formUrl: string
  driveFolderName?: string
  publishedAt: string
}

/** Quiz-tab state for one deck: whether Google is connected and the quiz, if any. */
export interface QuizStatus {
  googleConnected: boolean
  quiz?: PublishedQuiz
}

/** A Google Drive folder offered in the publish-destination picker (QUIZ-2). */
export interface DriveFolder {
  id: string
  name: string
}

/**
 * Result of quiz.connectGoogle: mock mode connects immediately; live mode
 * returns a Google consent URL the client must redirect the browser to.
 */
export type QuizConnectResult =
  { status: 'connected' } | { status: 'redirect'; url: string }
