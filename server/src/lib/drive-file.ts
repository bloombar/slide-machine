/**
 * Reading a text file out of a user's connected Google Drive (EXP-4).
 *
 * Import may come from an upload or a connected account (EXP-3), and the
 * connected-account half needs exactly one thing Drive can do and the app
 * could not already: hand back the bytes of a file the user can see. Listing
 * and folder creation live in `quiz-google.ts`; this is the read.
 *
 * The account already grants `drive.readonly`, which is what the Slides import
 * uses, so nothing here asks a user to reconnect (P-5: reads are read-only and
 * never modify the source file).
 */

/** A Drive read that could not be completed, with whether reconnecting helps. */
export class DriveFileUnreadableError extends Error {
  constructor(
    message: string,
    readonly reconnect = false,
    /** Whether the file simply was not there — a different thing to ask the
     * user about than a refused read. */
    readonly notFound = false,
  ) {
    super(message)
    this.name = 'DriveFileUnreadableError'
  }
}

/**
 * The file id inside whatever the instructor pasted.
 *
 * A Drive file URL is `/file/d/<id>/view`; a link from some other corner of
 * Drive carries it as `?id=`. A bare id is accepted too, since that is what
 * someone who knows the system will paste. Anything else is refused here so
 * the complaint is about the link rather than a confusing 404 from Google.
 */
export const driveFileIdFrom = (input: string): string | null => {
  const text = input.trim()
  if (!text) return null
  const fromUrl = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(text)
  if (fromUrl) return fromUrl[1]!
  const fromQuery = /[?&]id=([a-zA-Z0-9_-]+)/.exec(text)
  if (fromQuery) return fromQuery[1]!
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : null
}

/** How much of a file will be read. A template export is a few kilobytes of
 * YAML; anything approaching this is not one, and reading it would be a way
 * to spend a lot of memory on someone else's mistake. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Downloads a Drive file's contents as text.
 *
 * `alt=media` asks for the bytes rather than the metadata. Google's own
 * documents (a Doc, a Sheet) refuse that and must be exported instead — which
 * is right for us, because a template export is an uploaded plain file and a
 * Google-native document is never one.
 */
export const readDriveFileTextLive = async (
  accessToken: string,
  fileId: string,
): Promise<string> => {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (res.status === 401 || res.status === 403) {
    throw new DriveFileUnreadableError(
      'Google would not let this account read that file',
      true,
    )
  }
  if (res.status === 404) {
    throw new DriveFileUnreadableError(
      'That file was not found in Drive',
      false,
      true,
    )
  }
  if (!res.ok) {
    throw new DriveFileUnreadableError(
      `Google Drive read failed (${res.status})`,
    )
  }

  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) {
    throw new DriveFileUnreadableError(
      'That file is too large to be a template',
    )
  }
  const text = await res.text()
  // Measured rather than trusted: a chunked response declares no length, so
  // the header alone would let an oversized file through.
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw new DriveFileUnreadableError(
      'That file is too large to be a template',
    )
  }
  return text
}
