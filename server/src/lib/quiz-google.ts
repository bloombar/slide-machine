/**
 * Live Google publishing (SPEC QUIZ-3/QUIZ-4): lists the destination folders
 * and creates the real Google Form via the imported Quiz Generator library,
 * using an authorized client built from the instructor's stored refresh token.
 *
 * Scope note: the connected account grants `drive.readonly` (browse the whole
 * Drive) plus `drive.file` (create the Form + app folders and place the Form in
 * the chosen folder). The browser lists sub-folders per-parent, so it walks the
 * instructor's real Drive tree; instructors who connected before the
 * `drive.readonly` scope was added must reconnect once to gain it.
 */
import { createGoogleFormFromQuiz, type QuizForm } from 'google-forms-quiz-tool'
import type {
  DriveFolder,
  DriveImportable,
  QuizDefinition,
} from '@slide-machine/shared'
import { accessTokenFor, clientForRefreshToken } from '../auth/google-connect'
import { toQuizYamlObject, type QuizYamlOptions } from './quiz-yaml'
import type { QuizPublishResult } from './quiz-publish'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** A fresh access token for the connected account's Drive REST calls. */
/** The connected account's bearer token. One helper, shared with the import
 * path: a second copy here is what let a dead connection report itself as a
 * server fault on this side while the other side offered a reconnect. */
const driveAccessToken = accessTokenFor

/**
 * The sub-folders directly inside `parentId` ('root' = My Drive). Under
 * `drive.file` this is only folders the app created; with `drive.readonly` it
 * is the user's whole Drive tree. Files are intentionally NOT listed — the
 * picker chooses a destination folder. Sorted by name.
 */
export const listDriveFoldersLive = async (
  refreshToken: string,
  parentId = 'root',
): Promise<DriveFolder[]> => {
  const token = await driveAccessToken(refreshToken)
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '200',
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

/** What an import can read out of Drive: a presentation to derive from
 * (TMPL-8/EXP-5), a PowerPoint file to convert, or a file this app exported
 * earlier (EXP-3). Anything else in the folder is noise to someone choosing
 * what to import. */
const IMPORTABLE_MIMES = [
  'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-yaml',
  'text/yaml',
  'text/plain',
]

/**
 * The importable files directly inside `parentId` ('root' = My Drive).
 *
 * The folder picker deliberately lists no files — it chooses a destination,
 * and a destination is a folder. Importing is the opposite errand: the point
 * IS the file, so this lists them, filtered to the kinds an import can
 * actually read. A `.yaml` often arrives as `text/plain`, which is why that
 * is here; the parser decides whether it is really one.
 */
export const listDriveImportablesLive = async (
  refreshToken: string,
  parentId = 'root',
): Promise<DriveImportable[]> => {
  const token = await driveAccessToken(refreshToken)
  const kinds = IMPORTABLE_MIMES.map(m => `mimeType='${m}'`).join(' or ')
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and (${kinds}) and trashed=false`,
    fields: 'files(id,name,mimeType)',
    pageSize: '200',
    orderBy: 'name',
    spaces: 'drive',
  })
  const res = await fetch(`${DRIVE_FILES}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive file list failed (${res.status})`)
  const data = (await res.json()) as {
    files?: { id: string; name: string; mimeType: string }[]
  }
  return (data.files ?? []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
  }))
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
