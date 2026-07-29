/**
 * Deck export data models (SPEC EXP-1/EXP-2/EXP-4). A deck can be exported
 * to a standards-based, human-readable YAML file, to a PDF, or to Google
 * Slides. YAML and PDF may be downloaded directly or saved to the connected
 * Google Drive; Google Slides is always created in Drive.
 *
 * The YAML export is import-compatible (EXP-3): it also carries the General-tab
 * settings (language, AI freedom, narration voice) so a re-import restores them.
 * Seed notes and seed material are deliberately NOT carried — they can hold
 * private or copyrighted source content that should not travel in a shareable
 * file.
 */
import type { Deck } from './deck'

/** The formats a deck can be exported to (EXP-1/EXP-2). */
export type DeckExportFormat = 'pdf' | 'google-slides' | 'yaml'

/** Formats that can be produced as bytes for a direct browser download.
 * Google Slides is Drive-only (it is a live Google document, not a file). */
export type DeckDownloadFormat = 'pdf' | 'yaml'

/**
 * Whether a Google account is connected (so Drive/Slides export is possible)
 * and the deck's title, used to name the exported file.
 */
export interface ExportStatus {
  googleConnected: boolean
  deckTitle: string
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
 * The result of saving an export to Google Drive: the created file's name,
 * a link to open it, and the destination folder's name for confirmation.
 */
export interface ExportToDriveResult {
  fileName: string
  fileUrl: string
  driveFolderName?: string
}

/**
 * The General-tab lecture settings carried in a deck export and restored on
 * import (EXP-3): explicit language, AI freedom, and narration voice. Each is
 * optional; a missing value simply isn't restored. Seed notes are intentionally
 * excluded — they can contain private instructor notes.
 */
export interface ExportedDeckSettings {
  language?: string
  generationFreedom?: number
  ttsVoice?: string
}

/**
 * The outcome of importing a deck YAML (EXP-3): the freshly created lecture and
 * any non-fatal warnings raised while restoring it (e.g. an unknown template
 * that fell back to the default, or a dropped invalid setting).
 */
export interface DeckImportResult {
  deck: Deck
  warnings: string[]
}
