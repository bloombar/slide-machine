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
import { templateToPptx, templatePictures } from './template-pptx'
import type { Template } from '@slide-machine/shared'
import type { ExportNote } from '@slide-machine/shared'
import type { ExportDeck } from './deck-yaml'
import { clientForRefreshToken } from '../auth/google-connect'

const DRIVE_UPLOAD =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
/** The same endpoint asked for in two steps: metadata first, then the bytes to
 * the URL it answers with. What Drive requires past the multipart ceiling. */
const DRIVE_UPLOAD_RESUMABLE =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

/**
 * The most Drive will take in one multipart request.
 *
 * Google's documented ceiling for a multipart upload is 5 MB; past it the
 * request is refused and the export reported only "could not save to Drive".
 * A deck used to be a few tens of kilobytes of text, so nothing came close —
 * then a design's own pictures started travelling with it (TMPL-8), and a
 * lecture of thirty slides on a template with a full-bleed backdrop is seven
 * megabytes of perfectly ordinary presentation.
 *
 * Held a little under the limit, because the multipart body carries the
 * metadata and the boundaries as well as the file.
 */
const MAX_MULTIPART_BYTES = 4.5 * 1024 * 1024

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

/** What Drive answers a failed upload with, said as plainly as Google said
 * it. A status alone reads as "try again" for refusals that will never
 * succeed on a retry. */
const uploadFailed = async (res: Response): Promise<Error> => {
  const reason = await res.text().catch(() => '')
  return new Error(
    `Drive upload failed (${res.status})${reason ? ` — ${reason.slice(0, 500)}` : ''}`,
  )
}

/**
 * A file too big for one request, uploaded the way Drive asks for.
 *
 * Two steps: the metadata goes first and Drive answers with a URL of its own
 * in the `Location` header, then the bytes are PUT to that URL. Sent whole
 * rather than in chunks — the point here is to clear the multipart ceiling,
 * and a lecture deck is megabytes rather than gigabytes, so the complexity of
 * resuming a broken transfer would buy nothing.
 */
const uploadResumable = async (
  token: string,
  metadata: Record<string, unknown>,
  file: { mimeType: string; data: Uint8Array },
): Promise<DriveFile> => {
  const start = await fetch(DRIVE_UPLOAD_RESUMABLE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.mimeType,
      'X-Upload-Content-Length': String(file.data.byteLength),
    },
    body: JSON.stringify(metadata),
  })
  if (!start.ok) throw await uploadFailed(start)
  const location = start.headers.get('location')
  // Drive accepted the metadata but named nowhere to send the file. Nothing
  // to do but say so — silently falling back would upload it twice.
  if (!location) throw new Error('Drive upload failed — no upload URL returned')

  const res = await fetch(location, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.mimeType,
    },
    body: file.data as BodyInit,
  })
  if (!res.ok) throw await uploadFailed(res)
  const data = (await res.json()) as { id: string; webViewLink?: string }
  return {
    id: data.id,
    fileUrl:
      data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
  }
}

/**
 * Uploads a file's bytes into the given Drive folder ('root' = My Drive) and
 * returns its id and shareable link. Uses a multipart/related request so the
 * metadata (name, parent) and the media travel in a single call — or two
 * requests when the file is past what Drive takes in one.
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
  // Past the multipart ceiling Drive wants the upload in two steps, so a long
  // lecture on a picture-heavy design still lands (see MAX_MULTIPART_BYTES).
  if (file.data.byteLength > MAX_MULTIPART_BYTES) {
    return uploadResumable(token, metadata, file)
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
  // Google's own reason, not just its status. A refusal here is one of several
  // unrelated things — a scope the grant does not cover, a quota spent, a file
  // too big to convert — and they want opposite things from the user. Reported
  // as a status alone, every one of them reads as "could not save to Drive,
  // please try again", which is advice for none of them.
  if (!res.ok) throw await uploadFailed(res)
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
  /** Collects what the format could not carry (EXP-7). */
  notes?: ExportNote[],
  /** Write the deck's template as the presentation's own layouts (EXP-1). */
  withLayouts = false,
): Promise<DriveFile> => {
  const pptx = await deckToPptx(deck, notes, withLayouts)
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

/**
 * Creates a native Google Slides presentation from a style TEMPLATE (EXP-6):
 * its layouts become the presentation's layouts, with one demonstration slide
 * each. Same route as a deck — a .pptx uploaded with conversion — so it needs
 * no Slides scope either.
 */
export const createGoogleSlidesFromTemplateLive = async (
  refreshToken: string,
  template: Template,
  folderId = 'root',
): Promise<DriveFile> => {
  const pptx = await templateToPptx(template, await templatePictures(template))
  return uploadFileToDriveLive(
    refreshToken,
    {
      name: template.name,
      mimeType: PPTX_MIME,
      data: pptx,
      convertTo: GOOGLE_SLIDES_MIME,
    },
    folderId,
  )
}
