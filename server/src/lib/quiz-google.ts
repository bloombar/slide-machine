/**
 * Live Google publishing (SPEC QUIZ-3/QUIZ-4): lists the destination folders
 * and creates the real Google Form via the imported Quiz Generator library,
 * using an authorized client built from the instructor's stored refresh token.
 *
 * Scope note: the connected account grants `drive.file`, which only covers
 * files this app creates — it cannot enumerate the user's existing folders.
 * So the Form is created in the user's My Drive; true folder selection would
 * need the Google Picker or a broader Drive scope (future work).
 */
import { createGoogleFormFromQuiz, type QuizForm } from 'google-forms-quiz-tool'
import type { DriveFolder, QuizDefinition } from '@slide-machine/shared'
import { clientForRefreshToken } from '../auth/google-connect'
import { toQuizYamlObject } from './quiz-yaml'
import type { QuizPublishResult } from './quiz-publish'

/** Destinations offered in live mode. `drive.file` can't list existing
 * folders, so only My Drive (root) is offered. */
export const listDriveFoldersLive = async (): Promise<DriveFolder[]> => [
  { id: 'root', name: 'My Drive' },
]

/** Creates the real Google Form and returns its id and shareable URL. */
export const publishQuizLive = async (
  def: QuizDefinition,
  refreshToken: string,
  driveFolderId: string,
): Promise<QuizPublishResult> => {
  const auth = clientForRefreshToken(refreshToken)
  // toQuizYamlObject produces exactly the library's QuizForm shape.
  const quiz = toQuizYamlObject(def) as QuizForm
  const { formId, responderUri } = await createGoogleFormFromQuiz(quiz, {
    auth,
    // 'root' = My Drive: leave the Form where it is created (no move).
    folderId: driveFolderId === 'root' ? undefined : driveFolderId,
  })
  if (!responderUri) {
    throw new Error('Google returned no form URL')
  }
  return { formId, formUrl: responderUri }
}
