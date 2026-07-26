/**
 * Live Google export helpers (SPEC EXP-1/EXP-4). Two destinations backed by the
 * instructor's stored refresh token:
 *   - uploadFileToDriveLive — uploads a generated PDF or YAML file into a chosen
 *     Drive folder (via the Drive multipart upload endpoint).
 *   - createGoogleSlidesLive — builds a native Google Slides presentation from
 *     the deck (via the Slides API) and moves it into the chosen folder.
 *
 * Scope note: file upload needs only `drive.file` (already granted for the quiz
 * feature). Google Slides additionally needs the `presentations` scope and the
 * Slides API enabled on the project; instructors connected before that scope was
 * added must reconnect once to gain it.
 */
import type { ExportDeck, ExportSlide } from './deck-yaml'
import { clientForRefreshToken } from '../auth/google-connect'

const DRIVE_UPLOAD =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const SLIDES_API = 'https://slides.googleapis.com/v1/presentations'

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

/**
 * Uploads a file's bytes into the given Drive folder ('root' = My Drive) and
 * returns its id and shareable link. Uses a multipart/related request so the
 * metadata (name, parent) and the media travel in a single call.
 */
export const uploadFileToDriveLive = async (
  refreshToken: string,
  file: { name: string; mimeType: string; data: Uint8Array },
  folderId = 'root',
): Promise<DriveFile> => {
  const token = await accessToken(refreshToken)
  const metadata = {
    name: file.name,
    mimeType: file.mimeType,
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

/** Joins a slide's body and bullet points into the presentation body text,
 * prefixing bullets with a marker. Empty when the slide has neither. */
const slideBodyText = (slide: ExportSlide): string => {
  const lines: string[] = []
  if (slide.body) lines.push(slide.body)
  for (const bullet of slide.bullets ?? []) lines.push(`• ${bullet}`)
  return lines.join('\n')
}

/**
 * Creates a native Google Slides presentation from the deck and moves it into
 * the chosen Drive folder, returning its id and edit URL. Each deck slide
 * becomes a TITLE_AND_BODY slide with the title and body/bullets filled in; the
 * blank slide the API creates by default is removed.
 */
export const createGoogleSlidesLive = async (
  refreshToken: string,
  deck: ExportDeck,
  folderId = 'root',
): Promise<DriveFile> => {
  const token = await accessToken(refreshToken)
  const auth = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  // Create the presentation (this yields one blank default slide).
  const createRes = await fetch(SLIDES_API, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: deck.title }),
  })
  if (!createRes.ok) {
    throw new Error(`Slides create failed (${createRes.status})`)
  }
  const created = (await createRes.json()) as {
    presentationId: string
    slides?: Array<{ objectId: string }>
  }
  const presentationId = created.presentationId

  // Build one TITLE_AND_BODY slide per deck slide, filling in text as we go.
  const requests: unknown[] = []
  deck.slides.forEach((slide, i) => {
    const slideId = `sm_slide_${i}`
    const titleId = `sm_title_${i}`
    const bodyId = `sm_body_${i}`
    requests.push({
      createSlide: {
        objectId: slideId,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId },
        ],
      },
    })
    if (slide.title) {
      requests.push({
        insertText: { objectId: titleId, text: slide.title, insertionIndex: 0 },
      })
    }
    const body = slideBodyText(slide)
    if (body) {
      requests.push({
        insertText: { objectId: bodyId, text: body, insertionIndex: 0 },
      })
    }
  })
  // Remove the blank default slide the API created.
  const defaultSlideId = created.slides?.[0]?.objectId
  if (defaultSlideId) {
    requests.push({ deleteObject: { objectId: defaultSlideId } })
  }

  if (requests.length) {
    const batchRes = await fetch(`${SLIDES_API}/${presentationId}:batchUpdate`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ requests }),
    })
    if (!batchRes.ok) {
      throw new Error(`Slides batchUpdate failed (${batchRes.status})`)
    }
  }

  // Slides land in My Drive root; move into the chosen folder when one is set.
  if (folderId && folderId !== 'root') {
    const moveRes = await fetch(
      `${DRIVE_FILES}/${presentationId}?addParents=${folderId}&removeParents=root`,
      { method: 'PATCH', headers: auth, body: '{}' },
    )
    if (!moveRes.ok) throw new Error(`Slides move failed (${moveRes.status})`)
  }

  return {
    id: presentationId,
    fileUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
  }
}
