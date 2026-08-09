/**
 * Deck export actions (SPEC EXP-1/EXP-2/EXP-4). The Export tab in lecture
 * settings drives these:
 *   - export.status   — deck title (file name), whether Google is connected,
 *                       whether the deck has whiteboard marks, and the deck's
 *                       previously-saved Drive exports.
 *   - export.download — generate a PDF or YAML file and return its bytes inline
 *                       for the browser to download.
 *   - export.toDrive  — generate a PDF/YAML and upload it, or build a Google
 *                       Slides presentation, saving into the chosen Drive folder
 *                       and recording it on the deck so it can be deleted later.
 *   - export.delete   — remove a saved export (trash it in Drive, forget it).
 *
 * The Drive folder picker reuses the shared quiz.driveFolders / quiz.createFolder
 * actions (a Google connection is all they need). Two modes select the Google
 * side, mirroring the quiz feature:
 *   - 'mock' (tests/dev): connect is a flag and Drive URLs are fabricated.
 *   - 'live': files upload to the connected Drive and Slides are built for real.
 * Direct downloads always run for real — they never contact Google.
 *
 * Freehand whiteboard marks (WB-1) are drawn into the PDF and Google Slides when
 * `includeWhiteboard` is set; YAML omits them (it has no visual surface, and the
 * marks are large coordinate arrays), so the client only offers the option for
 * the visual formats.
 */
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import type { HydratedDocument } from 'mongoose'
import type {
  DeckExportFormat,
  ExportDownload,
  ExportStatus,
  ExportToDriveResult,
  ExportedFile,
  Locale,
} from '@slide-machine/shared'
import {
  LOCALES,
  deckSourceLocale,
  overlaySlideTranslation,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction } from './dispatch'
import {
  deckEditor,
  isConnected,
  requiresGoogleDrive,
  withGoogleAccount,
  type DeckAccess,
  type WithGoogle,
} from './access'
import { requireExports } from '../billing/meter-hooks'
import { meterUsage } from '../billing/usage-context'
import { SlideModel } from '../models/slide'
import { ProjectModel } from '../models/project'
import { type DeckExportDb, type DeckDb } from '../models/deck'
import { translateSlides, translationEnabled } from '../lib/translate-slides'
import { translationBillingFor } from '../billing/translation-usage'
import { deckToYaml, type ExportDeck, type ExportSlide } from '../lib/deck-yaml'
import { deckToPdf } from '../lib/deck-pdf'
import { visibleStrokes } from '../lib/deck-drawings'
import { resolveTemplateTheme } from '../lib/deck-theme'
import { resolveDeckTemplate } from '../templates/versions'
import { slotsOf } from '../lib/slide-slots'
import {
  uploadFileToDriveLive,
  createGoogleSlidesLive,
  deleteDriveFileLive,
} from '../lib/export-google'
import { decryptToken } from '../lib/token-crypto'

import { isLive } from '../lib/export-mode'

// Re-exported for the modules that have always reached for it here.
export { isLive }

/** MIME types for the downloadable formats. */
const MIME = {
  pdf: 'application/pdf',
  yaml: 'application/x-yaml',
} as const

/** The content gate, shared by every export action. */
const byDeckId = deckEditor((input: { deckId: string }) => input.deckId)

/** A filesystem-safe base name derived from the deck title. */
const slugifyTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'deck'

/**
 * Builds the export model (deck + slides in display order) from an already-
 * loaded, editable deck. Taking the deck rather than re-fetching it lets a
 * caller that also needs the document (to record the export) load it just once.
 * Whiteboard marks are attached only when `includeWhiteboard` is set (and only
 * strokes that are still visible), so the renderer draws exactly what's wanted.
 *
 * `locale` exports the deck as it reads in another language (SHARE-2): the
 * slide text is overlaid with its translation, computed and cached on the same
 * read-through path the viewer uses, so a translated export costs nothing extra
 * once someone has read the deck in that language. The stored slides are never
 * modified — only what this function hands the renderers changes.
 *
 * Exporting is always authoring work — the deck is editable to have got here —
 * so a translation this triggers spends the owner's own allowance rather than
 * the audience pool (BILL-3), and is refused with a 402 when that allowance is
 * gone. The `exports` unit the caller counts is separate: one file produced is
 * one export, whether or not translating it cost anything.
 */
export const buildExportDeck = async (
  deck: HydratedDocument<DeckDb>,
  includeWhiteboard: boolean,
  locale?: Locale,
): Promise<ExportDeck> => {
  const slideDocs = await SlideModel.find({ deckId: deck._id }).sort({
    index: 1,
  })
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  const source = deckSourceLocale(deck.language, project?.language ?? undefined)
  // Asking for the language the deck is already in is a no-op, not a call.
  const translation =
    locale && locale !== source && translationEnabled()
      ? await translateSlides(
          deck._id,
          slideDocs.map(s => ({
            id: s._id.toString(),
            title: s.title,
            body: s.body,
            bullets: s.bullets,
            caption: s.caption,
          })),
          source,
          locale,
          await translationBillingFor(deck.ownerId.toString(), 'author'),
        )
      : {}
  const slides: ExportSlide[] = slideDocs.map(doc => {
    const s = overlaySlideTranslation(
      {
        title: doc.title,
        body: doc.body,
        bullets: doc.bullets,
        caption: doc.caption,
        slots: slotsOf(doc),
      },
      translation[doc._id.toString()],
    )
    return {
      layoutType: doc.layoutType,
      // Carried whole so an arranged layout exports from its own boxes,
      // including slots the template's author named (TMPL-9).
      slots: s.slots,
      title: s.title,
      body: s.body,
      bullets: s.bullets,
      imageRef: doc.imageRef,
      imageSource: doc.imageSource,
      caption: s.caption,
      attribution: doc.attribution,
      narration: doc.sourceTranscript,
      drawings: includeWhiteboard ? visibleStrokes(doc.drawings) : undefined,
    }
  })
  // Resolve the template's theme so the export carries the same colors the
  // viewer shows (background, text, accent, muted).
  const template = await resolveDeckTemplate(deck)
  // General-tab settings make the export import-compatible (EXP-3). Seed notes
  // and seed material are deliberately excluded — they can hold private or
  // copyrighted content that should not travel in a shareable file.
  const settings = {
    language: deck.language,
    generationFreedom: deck.generationFreedom,
    ttsVoice: deck.ttsVoice,
  }
  const hasSettings = Object.values(settings).some(v => v !== undefined)
  return {
    title: deck.title,
    templateId: deck.templateId,
    theme: resolveTemplateTheme(template?.theme),
    templateTheme: template?.theme,
    // The renderers read an arrangement from these; a layout with none keeps
    // its hand-tuned arrangement, exactly as on screen.
    layouts: template?.layouts,
    ...(hasSettings ? { settings } : {}),
    slides,
  }
}

/** Maps a stored export record to its client shape. */
const toExportedFile = (e: DeckExportDb): ExportedFile => ({
  fileId: e.fileId,
  fileUrl: e.fileUrl,
  fileName: e.fileName,
  format: e.format,
  driveFolderName: e.driveFolderName,
  exportedAt: e.exportedAt.toISOString(),
})

/**
 * The deck's title (used to name the export), whether Google is connected,
 * whether the deck has any whiteboard marks (so the include-whiteboard option
 * can be hidden when there are none), and the saved Drive exports.
 */
export const exportStatus = defineAction<
  { deckId: string },
  ExportStatus,
  WithGoogle<DeckAccess>
>({
  name: 'export.status',
  access: withGoogleAccount(byDeckId),
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input, { deck, googleUser }) => {
    // "Has whiteboard marks" must mean the same thing the exporter draws:
    // strokes that are still visible. The stored list also holds erased and
    // orphaned strokes, so narrow to slides that have any drawings, then keep
    // only those with visible strokes (via the shared visibleStrokes filter) —
    // otherwise the checkbox could offer marks the export would then omit.
    const drawn = await SlideModel.find({
      deckId: deck._id,
      'drawings.0': { $exists: true },
    }).select('drawings')
    const hasWhiteboard = drawn.some(s => visibleStrokes(s.drawings).length > 0)
    return {
      googleConnected: isConnected(googleUser, 'export'),
      deckTitle: deck.title,
      hasWhiteboard,
      exports: (deck.exports ?? []).map(toExportedFile),
    }
  },
})

/**
 * Generates a PDF or YAML export of the deck and returns its bytes base64-
 * encoded for the browser to download (EXP-1/EXP-2). PDF may include whiteboard
 * marks; YAML never does. No Google contact.
 *
 * Counts one `exports` unit (BILL-3), charged when the file has actually been
 * produced: a render that threw gave the user nothing to download.
 */
export const exportDownload = defineAction<
  {
    deckId: string
    format: 'pdf' | 'yaml'
    includeWhiteboard?: boolean
    locale?: Locale
  },
  ExportDownload,
  DeckAccess
>({
  name: 'export.download',
  access: byDeckId,
  meter: requireExports,
  input: z.object({
    deckId: z.string().min(1),
    format: z.enum(['pdf', 'yaml']),
    includeWhiteboard: z.boolean().optional(),
    // Export the deck as it reads in this language (SHARE-2); omitted exports
    // the authored text.
    locale: z.enum(LOCALES).optional(),
  }),
  execute: async (ctx, input, { deck: deckDoc }) => {
    // YAML has no visual surface, so whiteboard marks never apply to it.
    const includeWhiteboard =
      input.format === 'pdf' && input.includeWhiteboard !== false
    const deck = await buildExportDeck(deckDoc, includeWhiteboard, input.locale)
    const base = slugifyTitle(deck.title)
    if (input.format === 'yaml') {
      const yaml = deckToYaml(deck)
      await meterUsage('exports', 1)
      return {
        fileName: `${base}.yaml`,
        mimeType: MIME.yaml,
        contentBase64: Buffer.from(yaml, 'utf8').toString('base64'),
      }
    }
    const pdf = await deckToPdf(deck)
    await meterUsage('exports', 1)
    return {
      fileName: `${base}.pdf`,
      mimeType: MIME.pdf,
      contentBase64: Buffer.from(pdf).toString('base64'),
    }
  },
})

/** Whether whiteboard marks apply to a given format (visual formats only). */
const whiteboardApplies = (format: DeckExportFormat): boolean =>
  format === 'pdf' || format === 'google-slides'

/**
 * Saves an export to the connected Google Drive (EXP-4): a PDF or YAML file
 * uploaded into the chosen folder, or a native Google Slides presentation built
 * from the deck. Records it on the deck so it can be listed/deleted, and returns
 * the created file.
 *
 * Counts one `exports` unit (BILL-3), the same as a download — the deck is
 * rendered either way, and where the file lands is not what costs.
 */
export const exportToDrive = defineAction<
  {
    deckId: string
    format: 'pdf' | 'yaml' | 'google-slides'
    driveFolderId: string
    driveFolderName?: string
    includeWhiteboard?: boolean
    locale?: Locale
  },
  ExportToDriveResult,
  WithGoogle<DeckAccess>
>({
  name: 'export.toDrive',
  access: requiresGoogleDrive(byDeckId, 'export'),
  meter: requireExports,
  input: z.object({
    deckId: z.string().min(1),
    format: z.enum(['pdf', 'yaml', 'google-slides']),
    driveFolderId: z.string().min(1),
    driveFolderName: z.string().optional(),
    includeWhiteboard: z.boolean().optional(),
    // Save the deck as it reads in this language (SHARE-2); omitted saves the
    // authored text.
    locale: z.enum(LOCALES).optional(),
  }),
  execute: async (ctx, input, { deck: deckDoc, googleUser: user }) => {
    const includeWhiteboard =
      whiteboardApplies(input.format) && input.includeWhiteboard !== false
    const deck = await buildExportDeck(deckDoc, includeWhiteboard, input.locale)
    const base = slugifyTitle(deck.title)
    // A Google Slides file is named by the deck title; fall back to a non-empty
    // label for untitled lectures (an empty name also fails schema validation).
    const slidesTitle = deck.title.trim() || 'Untitled lecture'

    // Create the file (mock fabricates a URL; live really uploads/converts).
    let fileId: string
    let fileUrl: string
    const fileName =
      input.format === 'google-slides' ? slidesTitle : `${base}.${input.format}`

    if (!isLive()) {
      // A random suffix keeps every mock export distinct — two exports of the
      // same deck/format must not collide (the saved-exports list keys on
      // fileId, and delete matches on it).
      fileId = `mock-${base}-${input.format}-${randomBytes(4).toString('hex')}`
      fileUrl =
        input.format === 'google-slides'
          ? `https://docs.google.com/presentation/d/${fileId}/edit`
          : `https://drive.google.com/file/d/${fileId}/view`
    } else {
      // isConnected guarantees a stored token in live mode.
      const refreshToken = decryptToken(user.googleQuizRefreshToken!)
      if (input.format === 'google-slides') {
        const file = await createGoogleSlidesLive(
          refreshToken,
          { ...deck, title: slidesTitle },
          input.driveFolderId,
        )
        fileId = file.id
        fileUrl = file.fileUrl
      } else {
        const data =
          input.format === 'yaml'
            ? new TextEncoder().encode(deckToYaml(deck))
            : await deckToPdf(deck)
        const file = await uploadFileToDriveLive(
          refreshToken,
          { name: fileName, mimeType: MIME[input.format], data },
          input.driveFolderId,
        )
        fileId = file.id
        fileUrl = file.fileUrl
      }
    }

    // Record the export on the deck (newest last) so it can be deleted later.
    // savedBy records whose Drive the file lives in, so another editor deleting
    // it later can be told it still exists there (EXP-4).
    const record: DeckExportDb = {
      fileId,
      fileUrl,
      fileName,
      format: input.format,
      driveFolderId: input.driveFolderId,
      driveFolderName: input.driveFolderName,
      exportedAt: new Date(),
      savedBy: user._id,
    }
    deckDoc.exports = [...(deckDoc.exports ?? []), record]
    await deckDoc.save()
    await meterUsage('exports', 1)

    return {
      fileId,
      fileName,
      fileUrl,
      format: input.format,
      driveFolderName: input.driveFolderName,
      exportedAt: record.exportedAt.toISOString(),
    }
  },
})

/**
 * Deletes a saved Drive export (EXP-4): trashes it in the instructor's Drive
 * (best-effort in live mode) and forgets it on the deck. A Drive failure must
 * not block forgetting it locally.
 */
export const exportDelete = defineAction<
  { deckId: string; fileId: string },
  { deleted: boolean; remainsInOtherDrive?: boolean },
  WithGoogle<DeckAccess>
>({
  name: 'export.delete',
  access: withGoogleAccount(byDeckId),
  input: z.object({
    deckId: z.string().min(1),
    fileId: z.string().min(1),
  }),
  execute: async (ctx, input, { deck, googleUser: user }) => {
    const existing = deck.exports ?? []
    const record = existing.find(e => e.fileId === input.fileId)
    if (!record) {
      return { deleted: false }
    }
    // The file lives in whoever saved it's Drive. If that was a different
    // editor, this user's credentials can't trash it there — so flag that the
    // record is gone from the app but the file remains in the other Drive.
    const remainsInOtherDrive = Boolean(
      record.savedBy && record.savedBy.toString() !== ctx.userId,
    )
    if (isLive() && user.googleQuizRefreshToken && !remainsInOtherDrive) {
      const refreshToken = decryptToken(user.googleQuizRefreshToken)
      await deleteDriveFileLive(refreshToken, input.fileId).catch(() => {})
    }
    deck.exports = existing.filter(e => e.fileId !== input.fileId)
    await deck.save()
    return { deleted: true, remainsInOtherDrive }
  },
})

registerAction(exportStatus)
registerAction(exportDownload)
registerAction(exportToDrive)
registerAction(exportDelete)
