/**
 * Deck export data models (SPEC EXP-1/EXP-2/EXP-4). A deck can be exported
 * to a standards-based, human-readable YAML file, to a PDF, or to Google
 * Slides. YAML and PDF may be downloaded directly or saved to the connected
 * Google Drive; Google Slides is always created in Drive.
 */

/** The formats a deck can be exported to (EXP-1/EXP-2). */
export type DeckExportFormat = 'pdf' | 'google-slides' | 'yaml'

/** Formats that can be produced as bytes for a direct browser download.
 * Google Slides is Drive-only (it is a live Google document, not a file). */
export type DeckDownloadFormat = 'pdf' | 'yaml'

/**
 * Formats that can render the deck's freehand whiteboard marks (WB-1). PDF and
 * Google Slides draw the marks on the slide; YAML is a text format with no
 * visual surface (and the marks are hundreds of coordinate points each), so it
 * omits them — the include-whiteboard option is therefore offered only for
 * these formats.
 */
export const WHITEBOARD_EXPORT_FORMATS: DeckExportFormat[] = [
  'pdf',
  'google-slides',
]

/** A deck export previously saved to Google Drive (EXP-4), so it can be listed
 * and deleted later — mirrors how a published quiz is tracked (QUIZ-3/QUIZ-6). */
export interface ExportedFile {
  /** Drive file id, used to open or trash it. */
  fileId: string
  fileUrl: string
  fileName: string
  format: DeckExportFormat
  driveFolderName?: string
  exportedAt: string
}

/**
 * Whether a Google account is connected (so Drive/Slides export is possible),
 * the deck's title (used to name the file), whether the deck has any whiteboard
 * marks (so the include-whiteboard option can be hidden when there are none),
 * and the deck's previously-saved Drive exports.
 */
export interface ExportStatus {
  googleConnected: boolean
  deckTitle: string
  hasWhiteboard: boolean
  exports: ExportedFile[]
}

/**
 * A generated export returned inline for the browser to download: the
 * suggested file name, its MIME type, and the file contents base64-encoded
 * (so binary PDFs survive the JSON transport intact).
 */
export interface ExportDownload {
  fileName: string
  mimeType: string
  contentBase64: string
}

/**
 * The result of saving an export to Google Drive: the created file (id, name,
 * link), its format, and the destination folder's name for confirmation.
 */
export interface ExportToDriveResult {
  fileId: string
  fileName: string
  fileUrl: string
  format: DeckExportFormat
  driveFolderName?: string
  exportedAt: string
}
