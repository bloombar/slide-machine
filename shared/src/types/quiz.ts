/**
 * Quiz data models (SPEC §15, §17). The Quiz Generator is a separate repo
 * imported in-process as a library; QuizRef links a deck to the Google Form
 * it published.
 */

/**
 * The question types the Quiz Generator library supports (QUIZ-7):
 *   - single_choice   — radio buttons, exactly one correct choice
 *   - multiple_choice — checkboxes, any number of correct choices
 *   - short_text      — one-line answer (optional accepted answers)
 *   - long_text       — paragraph answer (manually graded)
 */
export type QuizQuestionType =
  'single_choice' | 'multiple_choice' | 'short_text' | 'long_text'

/**
 * A single generated question. `type` selects which of the optional fields
 * apply; the shape maps to the imported Quiz Generator library's model.
 */
export interface QuizQuestion {
  type: QuizQuestionType
  question: string
  points?: number
  /** Choice text (single_choice, multiple_choice). */
  choices?: string[]
  /** single_choice: index of the one correct choice. */
  correctIndex?: number
  /** multiple_choice: indices of the correct choices. */
  correctIndexes?: number[]
  /** short_text: accepted answers for auto-grading (omit = manually graded). */
  correctAnswers?: string[]
}

/** How many questions of each type to generate (advanced options, QUIZ-7). */
export type QuizQuestionCounts = Partial<Record<QuizQuestionType, number>>

/** A generated quiz definition, ready for review and publishing (QUIZ-1). */
export interface QuizDefinition {
  title: string
  description?: string
  questions: QuizQuestion[]
}

/**
 * How the published Form collects respondent emails (QUIZ-2): a Google-verified
 * email, one the responder types in, or none. The pilot defaults to 'verified'.
 */
export type QuizEmailCollection = 'verified' | 'responder_input' | 'none'

/**
 * Instructor-chosen generation options from the Quiz tab (QUIZ-7). Sent with
 * quiz.publish. Basic: questionCount, totalPoints. Advanced: emailCollection,
 * includeTranscript, per-type counts, and free-text AI instructions.
 */
export interface QuizGenerationOptions {
  /** Basic count; used when no per-type counts are given (all single_choice). */
  questionCount?: number
  /** Total points spread across the quiz (each question gets a whole share). */
  totalPoints?: number
  /** How to collect respondent emails (default 'verified'). */
  emailCollection?: QuizEmailCollection
  /** Fold the spoken transcript into the source material (default false). */
  includeTranscript?: boolean
  /** How many questions of each type; its sum overrides questionCount. */
  typeCounts?: QuizQuestionCounts
  /** Extra free-text instructions for the AI (topics to focus/avoid, etc.). */
  customInstructions?: string
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
  /** True when the lecture has a spoken transcript that can be folded into
   * generation (QUIZ-5); the UI shows the "include transcript" option only then. */
  hasTranscript: boolean
  /** The project's remembered quiz options, so the form pre-fills them (QUIZ-2). */
  defaults?: QuizGenerationOptions
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
