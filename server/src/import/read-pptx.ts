/**
 * Reading a PowerPoint file into the shape the importer already understands
 * (TMPL-8 / EXP-5), by letting Google convert it.
 *
 * ## Why not parse the .pptx
 *
 * A .pptx is a zip of OOXML, and reading it means writing a second reader
 * beside `read-slides.ts` — shapes, placeholder inheritance, text runs,
 * theme colours, transforms — against a format considerably messier than the
 * Slides API, which hands all of that back already structured. That reader
 * took a long tail of real-deck bugs to get right: boxes stacked in the
 * corner, colours lost to inheritance, fills painted where the deck had none.
 * A second one would earn its own tail.
 *
 * Drive already converts .pptx to Slides — it is the same conversion the
 * export path relies on in the other direction, and Google maintains it. So a
 * PowerPoint import is the Slides import with two extra steps: put the file
 * where Google can convert it, and take it away again.
 *
 * ## The file does not stay
 *
 * The upload is a means, not a result. The converted presentation is trashed
 * once it has been read, so an import does not silently litter the
 * instructor's Drive with copies of decks they only meant to bring in. It is
 * trashed rather than destroyed, so a failure mid-import leaves something
 * recoverable rather than nothing.
 */
import {
  uploadFileToDriveLive,
  deleteDriveFileLive,
} from '../lib/export-google'
import { driveFileMetaLive, copyAsSlidesLive } from '../lib/drive-file'
import { accessTokenFor } from '../auth/google-connect'
import {
  readPresentationLive,
  PresentationUnreadableError,
} from './read-slides'
import type { SourcePresentation } from './source-presentation'

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation'

/**
 * A PowerPoint file, read as a presentation.
 *
 * Takes the refresh token rather than an access token because it needs both
 * Drive (to upload and trash) and Slides (to read), and the two helpers mint
 * their own.
 */
export const readPptxLive = async (
  refreshToken: string,
  file: { name: string; data: Uint8Array },
): Promise<SourcePresentation> => {
  let fileId: string
  try {
    const uploaded = await uploadFileToDriveLive(refreshToken, {
      name: file.name,
      mimeType: PPTX_MIME,
      data: file.data,
      // Drive does the reading for us: what lands is a native presentation,
      // with no PowerPoint left in it.
      convertTo: GOOGLE_SLIDES_MIME,
    })
    fileId = uploaded.id
  } catch (err) {
    // Google's own reason, not ours. Swallowing it is what made every other
    // failure in this path report itself as "something went wrong": the one
    // fact worth having is why Drive refused.
    throw new PresentationUnreadableError(
      `Google could not open that PowerPoint file — ${
        err instanceof Error ? err.message : 'the upload failed'
      }`,
    )
  }

  try {
    return await readPresentationLive(
      await accessTokenFor(refreshToken),
      fileId,
    )
  } finally {
    // Always, including when the read threw: the copy existed to be read, and
    // a failed import should not leave one behind either. A trash that fails
    // is not worth failing the import over — the user has their lecture, and
    // the worst case is a file they can delete.
    await deleteDriveFileLive(refreshToken, fileId).catch(() => {})
  }
}

/**
 * Whatever a Drive file turns out to be, read as a presentation.
 *
 * A pasted Drive link says nothing about what it points at, and the three
 * kinds an import can use want three different things: a native presentation
 * is read where it stands, a PowerPoint has to be converted first, and
 * anything else is not a deck at all. Asking Drive what the file is beats
 * guessing from the link, which carries no type.
 *
 * The conversion is a copy, so the user's own file is never touched — and the
 * copy is trashed once read, exactly as an uploaded PowerPoint's is.
 */
export const readDriveSourceLive = async (
  refreshToken: string,
  fileId: string,
): Promise<SourcePresentation> => {
  const token = await accessTokenFor(refreshToken)
  const meta = await driveFileMetaLive(token, fileId)

  if (meta.mimeType === GOOGLE_SLIDES_MIME) {
    return readPresentationLive(token, fileId)
  }

  if (meta.mimeType !== PPTX_MIME) {
    throw new PresentationUnreadableError(
      `That Drive file is a ${meta.mimeType}, which is not a presentation`,
    )
  }

  // Drive converts on copy, so a PowerPoint already in Drive needs no
  // download and no re-upload: Google reads it in place.
  const copyId = await copyAsSlidesLive(token, fileId, meta.name)
  try {
    return await readPresentationLive(token, copyId)
  } finally {
    await deleteDriveFileLive(refreshToken, copyId).catch(() => {})
  }
}
