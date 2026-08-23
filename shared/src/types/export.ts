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
import type { Template } from './template'

/** The formats a deck can be exported to (EXP-1/EXP-2). */
/**
 * `pptx` is here because EXP-1 asks for "PDF, Google Slides, and other easily
 * supportable common formats", and PowerPoint is the one every institution
 * still passes around. It is also the cheapest to support: the Google Slides
 * export already builds a .pptx and lets Drive convert it, so offering the
 * file itself is the same work minus the upload.
 */
export type DeckExportFormat = 'pdf' | 'google-slides' | 'yaml' | 'pptx'

/** Formats that can be produced as bytes for a direct browser download.
 * Google Slides is Drive-only (it is a live Google document, not a file). */
export type DeckDownloadFormat = 'pdf' | 'yaml' | 'pptx'

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
  // PowerPoint draws the marks as native freeform shapes, the same as the PDF
  // does — a format that renders the slide renders what was drawn on it.
  'pptx',
]

/**
 * Formats that can carry the deck's template as reusable layout pages (EXP-1).
 *
 * A slide format has somewhere to put them: PowerPoint writes them as layouts,
 * and Google Slides keeps them through the conversion, which is what makes
 * "apply layout" work on the far side and what lets an import group the slides
 * by the design their author chose rather than clustering them afresh.
 *
 * The PDF has no such surface — it is a picture of each slide. YAML is left out
 * for the opposite reason: its export already carries the whole template, so
 * there is no second shape to choose between.
 */
export const LAYOUT_EXPORT_FORMATS: DeckExportFormat[] = [
  'google-slides',
  'pptx',
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
  /**
   * Whether this deployment offers EXP-1's second export shape — a lecture
   * carrying its template as reusable layout pages
   * (`EXPORT_REUSABLE_LAYOUTS`).
   *
   * Sent rather than assumed, so the option is absent where it does nothing.
   * A checkbox whose answer the server ignores is worse than no checkbox.
   */
  layoutsOffered: boolean
  exports: ExportedFile[]
}

/**
 * A generated export returned inline for the browser to download: the
 * suggested file name, its MIME type, and the file contents base64-encoded
 * (so binary PDFs survive the JSON transport intact).
 */
/**
 * Something a format could not carry (EXP-7).
 *
 * Structured rather than a sentence so the app says it in the reader's own
 * language. `detail` is the author's own content — the formula that would not
 * typeset — which is theirs and is not translated.
 */
export interface ExportNote {
  reason: 'math-not-typeset'
  detail: string
}

export interface ExportDownload {
  fileName: string
  mimeType: string
  contentBase64: string
  /** What the file could not carry, for the user to see rather than
   * discover (EXP-7). Absent when everything went in. */
  notes?: ExportNote[]
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
  /** As ExportDownload.notes (EXP-7). */
  notes?: ExportNote[]
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

/**
 * What an import did, in the terms the report is written in (TMPL-8/EXP-5).
 *
 * Shared rather than server-only because the screen that shows it is the point
 * of it: consolidation is a judgement and assets can fail, so the report is
 * surfaced to the instructor rather than logged, and a second copy of this
 * shape on the client is a second thing to keep in step.
 */
export interface ImportReport {
  slidesRead: number
  layoutsCreated: number
  /** The biggest merge that happened, which is the one worth mentioning. */
  largestMerge?: { type: string; slides: number }
  /** Slides that matched no design and were drawn with the nearest one. */
  approximated: number
  /**
   * Images that could not be fetched, so the layout has an empty box.
   *
   * ABSENT means no fetch was attempted — an import given nowhere to store
   * pictures skips them entirely. It is not the same as zero, and it used to
   * be reported as zero, which is the most reassuring number this field can
   * carry: "every picture came through" and "we never looked" were
   * indistinguishable. A count that reads well for a reason unrelated to what
   * it counts is worse than no count.
   */
  assetsFailed?: number
  /**
   * Content that could not be placed, by the slide it was on (EXP-5).
   *
   * Named rather than counted, because "3 boxes were dropped" is not something
   * an instructor can act on and "slide 4: image" is. Slides are numbered as
   * the deck presents them, since that is how their author refers to them.
   *
   * Absent for a template-only import, which reads no content to lose.
   */
  contentDropped?: { slide: number; slots: string[] }[]
}

/**
 * The outcome of creating a lecture from a Google Slides presentation (EXP-5):
 * the lecture, the style template its design became, and the same report the
 * template import returns — which now also covers the content side.
 *
 * The template comes back because it is a deliverable in its own right: an
 * instructor may keep only the design and throw the lecture away, and cannot
 * do that without being told the template exists.
 */
export interface DeckImportFromSlidesResult {
  deck: Deck
  template: Template
  report: ImportReport
}
