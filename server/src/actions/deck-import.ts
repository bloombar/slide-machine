/**
 * Deck round-trip import (SPEC EXP-3). `deck.import` takes a previously exported
 * deck YAML and recreates it as a brand-new lecture in one of the caller's
 * projects. The importer becomes the owner with the project's default privacy;
 * quiz, refine settings, sharing, seed notes, and seed material are not carried
 * (per the product decision — see the exporter in `lib/deck-yaml.ts`).
 *
 * Safety (EXP-3): the whole document is validated up front and, on any problem,
 * nothing is created. All writes target fresh documents, so existing data is
 * never touched; if a write fails midway the just-created deck is rolled back so
 * no partial lecture is left behind.
 */
import { z } from 'zod'
import {
  LOCALES,
  type DeckImportResult,
  type Locale,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import { parseDeckImport, type ImportedDeck } from '../lib/deck-import'
import { permalinkSlug } from '../lib/slug'
import { getBuiltinTemplate } from '../templates/builtin'
import { ttsVoiceIdSchema } from '../lib/tts-voice'
import { DeckModel, resolveDeckAcl, toDeckDto } from '../models/deck'
import { SlideModel } from '../models/slide'
import { ProjectModel } from '../models/project'
import { deleteDeckCascade } from '../lib/cascade'

interface ResolvedSettings {
  templateId: string
  language?: Locale
  generationFreedom?: number
  ttsVoice?: string
  warnings: string[]
}

/**
 * Validates the imported template + General-tab settings against what the app
 * accepts, keeping the valid ones and collecting a warning for each dropped or
 * substituted value. An unknown template falls back to `classic` rather than
 * failing the whole import (EXP-3 "restore faithfully… if possible").
 */
const resolveSettings = (doc: ImportedDeck): ResolvedSettings => {
  const warnings: string[] = []

  let templateId = doc.templateId
  if (!getBuiltinTemplate(templateId)) {
    warnings.push(
      `Unknown template "${templateId}" — using the default template instead.`,
    )
    templateId = 'classic'
  }

  const s = doc.settings ?? {}

  let language: Locale | undefined
  if (s.language !== undefined) {
    if ((LOCALES as readonly string[]).includes(s.language)) {
      language = s.language as Locale
    } else {
      warnings.push(`Unsupported language "${s.language}" — not applied.`)
    }
  }

  let generationFreedom: number | undefined
  if (s.generationFreedom !== undefined) {
    const n = s.generationFreedom
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      generationFreedom = n
    } else {
      warnings.push(`AI freedom "${n}" is out of range (1–5) — not applied.`)
    }
  }

  let ttsVoice: string | undefined
  if (s.ttsVoice !== undefined) {
    if (ttsVoiceIdSchema.safeParse(s.ttsVoice).success) {
      ttsVoice = s.ttsVoice
    } else {
      warnings.push(`Unknown narration voice "${s.ttsVoice}" — not applied.`)
    }
  }

  return {
    templateId,
    language,
    generationFreedom,
    ttsVoice,
    warnings,
  }
}

/**
 * Imports a deck YAML into a new lecture in the caller's project. Returns the
 * created deck plus any non-fatal warnings raised while restoring it.
 */
export const deckImport = defineAction<
  { projectId: string; content: string },
  DeckImportResult
>({
  name: 'deck.import',
  input: z.object({
    projectId: z.string().min(1),
    content: z.string().min(1),
  }),
  authorize: async (ctx: ActionContext, input) => {
    if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
    const project = await ProjectModel.findById(input.projectId).catch(
      () => null,
    )
    if (!project || project.ownerId.toString() !== ctx.userId) {
      throw new ActionForbiddenError()
    }
  },
  execute: async (ctx, input) => {
    const parsed = parseDeckImport(input.content)
    if ('errors' in parsed) {
      throw new ActionValidationError('deck.import', parsed.errors)
    }
    const doc = parsed.data
    const project = await ProjectModel.findById(input.projectId)
    if (!project) throw new ActionForbiddenError()

    const settings = resolveSettings(doc)
    const title = doc.title.trim()

    // Create the new lecture. A titled import is treated as user-named so the
    // AI won't retitle it (mirrors deck.create).
    const deck = await DeckModel.create({
      projectId: project._id,
      ownerId: ctx.userId,
      title,
      titleLocked: Boolean(title),
      templateId: settings.templateId,
      permalinkSlug: permalinkSlug(title || 'untitled'),
      language: settings.language,
      generationFreedom: settings.generationFreedom,
      ttsVoice: settings.ttsVoice,
      slideOrder: [],
    })

    try {
      // Recreate slides in order; keep slideOrder in step with slide index.
      const order: string[] = []
      for (let i = 0; i < doc.slides.length; i++) {
        const s = doc.slides[i]!
        const slide = await SlideModel.create({
          deckId: deck._id,
          index: i,
          layoutType: s.layout,
          title: s.title,
          body: s.body,
          bullets: s.bullets?.length ? s.bullets : undefined,
          imageRef: s.image?.ref,
          caption: s.image?.caption,
          attribution: s.image?.attribution,
        })
        order.push(slide._id.toString())
      }
      deck.slideOrder = order
      await deck.save()
    } catch (err) {
      // Roll back the partial import so no orphaned lecture remains; existing
      // data was never touched (all writes were to these new documents).
      await deleteDeckCascade(deck).catch(() => {})
      throw err
    }

    const acl = resolveDeckAcl(deck, project)
    return { deck: toDeckDto(deck, acl), warnings: settings.warnings }
  },
})

registerAction(deckImport)
