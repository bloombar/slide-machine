/**
 * Live Google export helpers (SPEC EXP-1/EXP-4). Two destinations backed by the
 * instructor's stored refresh token:
 *   - uploadFileToDriveLive — uploads a generated file (PDF/YAML) into a chosen
 *     Drive folder, optionally asking Drive to CONVERT it (e.g. a .pptx into a
 *     native Google Slides presentation).
 *   - createGoogleSlidesLive — builds a .pptx from the deck and uploads it with
 *     conversion, so Drive turns it into a native, editable Google Slides file.
 *
 * Scope note: everything here needs only the Drive API + `drive.file` scope,
 * both already granted for the quiz feature. Google Slides is produced via
 * Drive's built-in .pptx→Slides conversion, so it needs NO separate Slides API
 * and NO extra OAuth scope — it works for any connected account.
 */
import { deckToPptx } from './deck-pptx'
import type { ExportDeck } from './deck-yaml'
import { clientForRefreshToken } from '../auth/google-connect'

const DRIVE_UPLOAD =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

/** The Google Apps MIME type for a native Google Slides presentation, and the
 * OpenXML MIME type of the .pptx we upload for conversion. */
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation'
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** A fresh access token for the connected account's REST calls. */
const accessToken = async (refreshToken: string): Promise<string> => {
  const { token } = await clientForRefreshToken(refreshToken).getAccessToken()
  if (!token) throw new Error('Could not obtain a Google access token')
  return token
}

/** A saved Drive file: its id and a link to open it. */
export interface DriveFile {
  id: string
  fileUrl: string
}

/** Moves a Drive file to the trash (EXP-4 delete). Used to remove an export the
 * app created; trashing (not permanent-deleting) is reversible from Drive. */
export const deleteDriveFileLive = async (
  refreshToken: string,
  fileId: string,
): Promise<void> => {
  const token = await accessToken(refreshToken)
  const res = await fetch(`${DRIVE_FILES}/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
  })
  if (!res.ok) throw new Error(`Drive trash failed (${res.status})`)
}

/**
 * Uploads a file's bytes into the given Drive folder ('root' = My Drive) and
 * returns its id and shareable link. Uses a multipart/related request so the
 * metadata (name, parent) and the media travel in a single call.
 *
 * When `convertTo` is set, Drive converts the uploaded media into that Google
 * Apps type on import (e.g. a .pptx → a native Google Slides file); the stored
 * file then has no bytes of the original format — it is the converted document.
 */
export const uploadFileToDriveLive = async (
  refreshToken: string,
  file: {
    name: string
    mimeType: string
    data: Uint8Array
    convertTo?: string
  },
  folderId = 'root',
): Promise<DriveFile> => {
  const token = await accessToken(refreshToken)
  const metadata = {
    name: file.name,
    // The DESTINATION type: the converted type when converting, else the media
    // type itself (a plain upload).
    mimeType: file.convertTo ?? file.mimeType,
    ...(folderId !== 'root' ? { parents: [folderId] } : {}),
  }
  const boundary = 'slide-machine-export-boundary'
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${file.mimeType}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const body = new Blob([head, file.data as BlobPart, tail], {
    type: `multipart/related; boundary=${boundary}`,
  })
  const res = await fetch(DRIVE_UPLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`)
  const data = (await res.json()) as { id: string; webViewLink?: string }
  return {
    id: data.id,
    fileUrl:
      data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
  }
}

/**
 * Builds a native Google Slides presentation from the deck by generating a
 * .pptx and uploading it to the chosen Drive folder with conversion. Returns
 * the created presentation's id and its "open in Slides" link.
 */
export const createGoogleSlidesLive = async (
  refreshToken: string,
  deck: ExportDeck,
  folderId = 'root',
): Promise<DriveFile> => {
  const pptx = await deckToPptx(deck)
  return uploadFileToDriveLive(
    refreshToken,
    {
      name: deck.title,
      mimeType: PPTX_MIME,
      data: pptx,
      convertTo: GOOGLE_SLIDES_MIME,
    },
    folderId,
  )
}
