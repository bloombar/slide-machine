/**
 * Live Google publishing (SPEC QUIZ-3/QUIZ-4): creates the real Google Form
 * via the imported Quiz Generator library, using an authorized client built
 * from the instructor's stored refresh token, and trashes it again on delete.
 *
 * Scope note: the connected account grants `drive.file` and nothing else.
 * That covers creating the Form (`forms.create` accepts it) and placing it in
 * the destination folder, because the instructor chose that folder in Google's
 * Picker and picking is what grants access to it. Nothing here lists a Drive —
 * `drive.file` cannot, deliberately (docs/GOOGLE_PRODUCTION_MODE.md).
 */
import { createGoogleFormFromQuiz, type QuizForm } from 'google-forms-quiz-tool'
import type { QuizDefinition } from '@slide-machine/shared'
import { accessTokenFor, clientForRefreshToken } from '../auth/google-connect'
import { toQuizYamlObject, type QuizYamlOptions } from './quiz-yaml'
import type { QuizPublishResult } from './quiz-publish'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

/** The connected account's bearer token. One helper, shared with the import
 * path: a second copy here is what let a dead connection report itself as a
 * server fault on this side while the other side offered a reconnect. */
const driveAccessToken = accessTokenFor

/** Creates the real Google Form and returns its id and shareable URL. The YAML
 * options carry publish settings such as email collection (QUIZ-7). */
export const publishQuizLive = async (
  def: QuizDefinition,
  refreshToken: string,
  driveFolderId: string,
  options: QuizYamlOptions = {},
): Promise<QuizPublishResult> => {
  const auth = clientForRefreshToken(refreshToken)
  // toQuizYamlObject produces exactly the library's QuizForm shape.
  const quiz = toQuizYamlObject(def, options) as QuizForm
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

/**
 * Moves a published Form to the instructor's Drive trash (QUIZ-6). The Form's
 * id is also its Drive file id, and `drive.file` covers files this app created,
 * so a PATCH marking it trashed suffices. Trashing (not permanent deletion)
 * keeps it recoverable. Throws on failure so the caller can decide whether to
 * ignore it — deleting the quiz locally must not hinge on Drive succeeding.
 */
export const deleteQuizLive = async (
  formId: string,
  refreshToken: string,
): Promise<void> => {
  const token = await driveAccessToken(refreshToken)
  const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(formId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
  })
  if (!res.ok) {
    throw new Error(`Drive trash failed (${res.status})`)
  }
}
