/**
 * Deck export actions (SPEC EXP-1/EXP-2/EXP-4). The Export tab in lecture
 * settings drives these:
 *   - export.status   — the deck title (for the file name) and whether Google
 *                       is connected (so Drive/Slides destinations are offered).
 *   - export.download — generate a PDF or YAML file and return its bytes inline
 *                       for the browser to download.
 *   - export.toDrive  — generate a PDF/YAML and upload it, or build a Google
 *                       Slides presentation, saving into the chosen Drive folder.
 *
 * The Drive folder picker reuses the shared quiz.driveFolders / quiz.createFolder
 * actions (a Google connection is all they need). Two modes select the Google
 * side, mirroring the quiz feature:
 *   - 'mock' (tests/dev): connect is a flag and Drive URLs are fabricated.
 *   - 'live': files upload to the connected Drive and Slides are built for real.
 * Direct downloads always run for real — they never contact Google.
 */
import { z } from 'zod'
import type {
  ExportDownload,
  ExportStatus,
  ExportToDriveResult,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import type { ActionContext } from './context'
import { loadEditableDeck } from './deck'
import { env } from '../config/env'
import { UserModel } from '../models/user'
import { SlideModel } from '../models/slide'
import { SeedAssetModel } from '../models/seed-asset'
import { deckToYaml, type ExportDeck, type ExportSlide } from '../lib/deck-yaml'
import { deckToPdf } from '../lib/deck-pdf'
import {
  uploadFileToDriveLive,
  createGoogleSlidesLive,
} from '../lib/export-google'
import { decryptToken } from '../lib/token-crypto'

const isLive = (): boolean => env.EXPORT_MODE === 'live'

/** MIME types for the downloadable formats. */
const MIME = {
  pdf: 'application/pdf',
  yaml: 'application/x-yaml',
} as const

/** Loads the acting user (with the encrypted Google token) or throws. */
const requireUser = async (ctx: ActionContext) => {
  const user = await UserModel.findById(ctx.userId).select(
    '+googleQuizRefreshToken',
  )
  if (!user) throw new ActionForbiddenError('Sign in required')
  return user
}

/** Whether the user can export to Drive. In live mode this needs a stored
 * refresh token; the mock-mode flag must not count once switched to live. */
const isConnected = (user: {
  googleConnected?: boolean
  googleQuizRefreshToken?: string
}): boolean =>
  isLive()
    ? Boolean(user.googleQuizRefreshToken)
    : Boolean(user.googleConnected)

/** A filesystem-safe base name derived from the deck title. */
const slugifyTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'deck'

/** Loads the deck and its slides (in display order) as the export model. */
const loadExportDeck = async (
  ctx: ActionContext,
  deckId: string,
): Promise<ExportDeck> => {
  const { deck } = await loadEditableDeck(ctx, deckId)
  const slideDocs = await SlideModel.find({ deckId: deck._id }).sort({
    index: 1,
  })
  const slides: ExportSlide[] = slideDocs.map(s => ({
    layoutType: s.layoutType,
    title: s.title,
    body: s.body,
    bullets: s.bullets,
    imageRef: s.imageRef,
    caption: s.caption,
    attribution: s.attribution,
  }))
  // General-tab settings and the extracted seed material make the export
  // import-compatible (EXP-3). Only ready assets contribute, and only their
  // pulled-out content — never the original binary file.
  const assets = await SeedAssetModel.find({
    deckId: deck._id,
    status: 'ready',
  }).sort({ createdAt: 1 })
  const settings = {
    language: deck.language,
    generationFreedom: deck.generationFreedom,
    ttsVoice: deck.ttsVoice,
    seedNotes: deck.seedContext,
  }
  const hasSettings = Object.values(settings).some(v => v !== undefined)
  return {
    title: deck.title,
    templateId: deck.templateId,
    ...(hasSettings ? { settings } : {}),
    seedMaterial: assets.map(a => ({
      name: a.name,
      type: a.type,
      text: a.text,
      caption: a.caption,
      keywords: a.keywords,
      enabled: a.enabled,
    })),
    slides,
  }
}

/**
 * The deck's title (used to name the export) and whether a Google account is
 * connected. Only a deck editor/owner may see this (loadEditableDeck enforces).
 */
export const exportStatus = defineAction<{ deckId: string }, ExportStatus>({
  name: 'export.status',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    return { googleConnected: isConnected(user), deckTitle: deck.title }
  },
})

/**
 * Generates a PDF or YAML export of the deck and returns its bytes base64-
 * encoded for the browser to download (EXP-1/EXP-2). No Google contact.
 */
export const exportDownload = defineAction<
  { deckId: string; format: 'pdf' | 'yaml' },
  ExportDownload
>({
  name: 'export.download',
  input: z.object({
    deckId: z.string().min(1),
    format: z.enum(['pdf', 'yaml']),
  }),
  execute: async (ctx, input) => {
    const deck = await loadExportDeck(ctx, input.deckId)
    const base = slugifyTitle(deck.title)
    if (input.format === 'yaml') {
      const yaml = deckToYaml(deck)
      return {
        fileName: `${base}.yaml`,
        mimeType: MIME.yaml,
        contentBase64: Buffer.from(yaml, 'utf8').toString('base64'),
      }
    }
    const pdf = await deckToPdf(deck)
    return {
      fileName: `${base}.pdf`,
      mimeType: MIME.pdf,
      contentBase64: Buffer.from(pdf).toString('base64'),
    }
  },
})

/**
 * Saves an export to the connected Google Drive (EXP-4): a PDF or YAML file
 * uploaded into the chosen folder, or a native Google Slides presentation built
 * from the deck. Returns the created file's name and a link to open it.
 */
export const exportToDrive = defineAction<
  {
    deckId: string
    format: 'pdf' | 'yaml' | 'google-slides'
    driveFolderId: string
    driveFolderName?: string
  },
  ExportToDriveResult
>({
  name: 'export.toDrive',
  input: z.object({
    deckId: z.string().min(1),
    format: z.enum(['pdf', 'yaml', 'google-slides']),
    driveFolderId: z.string().min(1),
    driveFolderName: z.string().optional(),
  }),
  execute: async (ctx, input) => {
    const user = await requireUser(ctx)
    if (!isConnected(user)) {
      throw new ActionForbiddenError('Connect a Google account first')
    }
    const deck = await loadExportDeck(ctx, input.deckId)
    const base = slugifyTitle(deck.title)

    // Mock mode: fabricate the resulting file URL without contacting Google.
    if (!isLive()) {
      const fileUrl =
        input.format === 'google-slides'
          ? `https://docs.google.com/presentation/d/mock-${base}/edit`
          : `https://drive.google.com/file/d/mock-${base}/view`
      const fileName =
        input.format === 'google-slides'
          ? deck.title
          : `${base}.${input.format}`
      return {
        fileName,
        fileUrl,
        driveFolderName: input.driveFolderName,
      }
    }

    // isConnected guarantees a stored token in live mode.
    const refreshToken = decryptToken(user.googleQuizRefreshToken!)

    if (input.format === 'google-slides') {
      const file = await createGoogleSlidesLive(
        refreshToken,
        deck,
        input.driveFolderId,
      )
      return {
        fileName: deck.title,
        fileUrl: file.fileUrl,
        driveFolderName: input.driveFolderName,
      }
    }

    const data =
      input.format === 'yaml'
        ? new TextEncoder().encode(deckToYaml(deck))
        : await deckToPdf(deck)
    const fileName = `${base}.${input.format}`
    const file = await uploadFileToDriveLive(
      refreshToken,
      { name: fileName, mimeType: MIME[input.format], data },
      input.driveFolderId,
    )
    return {
      fileName,
      fileUrl: file.fileUrl,
      driveFolderName: input.driveFolderName,
    }
  },
})

registerAction(exportStatus)
registerAction(exportDownload)
registerAction(exportToDrive)
