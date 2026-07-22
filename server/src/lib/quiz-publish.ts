/**
 * Quiz publishing seam (SPEC QUIZ-3). Given a generated quiz definition and
 * a target Drive folder, this returns the published Google Form's id and URL.
 *
 * This is the MOCK implementation: it fabricates a realistic, deterministic
 * Google Forms URL without contacting Google, so the whole Quiz-tab flow
 * works and is testable before the connected-account auth (EXP-4) and the
 * Quiz Generator library are wired up. To make it real, replace the body of
 * `publishQuiz` with: build an authorized OAuth2Client from the instructor's
 * stored token and call the imported Quiz Generator library
 * (`createGoogleFormFromQuiz(quiz, client, folderId)`). The signature and
 * return shape stay the same, so nothing upstream changes.
 */
import { createHash } from 'node:crypto'
import type { QuizDefinition } from '@slide-machine/shared'

export interface QuizPublishRequest {
  quiz: QuizDefinition
  /** Drive folder the Form is created in (its id from the picker). */
  driveFolderId: string
}

export interface QuizPublishResult {
  /** The created Form's id. */
  formId: string
  /** The shareable Form URL to hand to students. */
  formUrl: string
}

/**
 * Publishes a quiz to Google Forms. MOCK: derives a stable fake form id from
 * the quiz + folder so the same lecture yields the same URL, and returns a
 * Google-Forms-shaped link. The `mock-` id prefix marks it as not a real
 * form.
 */
export const publishQuiz = async (
  req: QuizPublishRequest,
): Promise<QuizPublishResult> => {
  const seed = `${req.driveFolderId}:${req.quiz.title}:${req.quiz.questions.length}`
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 32)
  const formId = `mock-${digest}`
  return {
    formId,
    formUrl: `https://docs.google.com/forms/d/e/${formId}/viewform`,
  }
}
