/**
 * Live Google publishing (SPEC QUIZ-3/QUIZ-4): lists the destination folders
 * and creates the real Google Form via the imported Quiz Generator library,
 * using an authorized client built from the instructor's stored refresh token.
 *
 * Scope note: the connected account grants `drive.file`, which covers only
 * files this app creates — so the folder browser currently shows just the
 * folders the app created (plus lets the instructor make new ones). The
 * browsing is written per-folder (by parentId) so it is forward-compatible:
 * once the connect also requests `drive.readonly` (see CONNECT_SCOPES in
 * auth/google-connect.ts) and the instructor reconnects, these same calls
 * return the user's entire Drive tree with no further change here.
 */
import { createGoogleFormFromQuiz, type QuizForm } from 'google-forms-quiz-tool'
import type { DriveFolder, QuizDefinition } from '@slide-machine/shared'
import { clientForRefreshToken } from '../auth/google-connect'
import { toQuizYamlObject } from './quiz-yaml'
import type { QuizPublishResult } from './quiz-publish'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** A fresh access token for the connected account's Drive REST calls. */
const driveAccessToken = async (refreshToken: string): Promise<string> => {
  const { token } = await clientForRefreshToken(refreshToken).getAccessToken()
  if (!token) throw new Error('Could not obtain a Google access token')
  return token
}

/**
 * The sub-folders directly inside `parentId` ('root' = My Drive). Under
 * `drive.file` this is only folders the app created; with `drive.readonly` it
 * becomes the user's whole tree. Sorted by name.
 */
export const listDriveFoldersLive = async (
  refreshToken: string,
  parentId = 'root',
): Promise<DriveFolder[]> => {
  const token = await driveAccessToken(refreshToken)
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '100',
    orderBy: 'name',
    spaces: 'drive',
  })
  const res = await fetch(`${DRIVE_FILES}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive folder list failed (${res.status})`)
  const data = (await res.json()) as { files?: { id: string; name: string }[] }
  return (data.files ?? []).map(f => ({ id: f.id, name: f.name }))
}

/**
 * Creates a folder inside `parentId` ('root' = My Drive) and returns it. The
 * app owns it under `drive.file`, so it then lists and can hold published Forms.
 */
export const createDriveFolderLive = async (
  refreshToken: string,
  name: string,
  parentId = 'root',
): Promise<DriveFolder> => {
  const token = await driveAccessToken(refreshToken)
  const res = await fetch(`${DRIVE_FILES}?fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      // Root is the default parent, so only pin a specific sub-folder.
      ...(parentId !== 'root' ? { parents: [parentId] } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Drive folder create failed (${res.status})`)
  const data = (await res.json()) as { id: string; name: string }
  return { id: data.id, name: data.name }
}

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
