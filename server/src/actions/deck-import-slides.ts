/**
 * Creating a lecture from an existing Google Slides presentation (SPEC EXP-5).
 *
 * An instructor arrives with a deck they already teach from. TMPL-8 turns its
 * design into a style template; this turns the same read into the lecture as
 * well, so the deck they know comes back as slides they can lecture over,
 * refine and export — rather than as a design they must then refill by hand.
 *
 * ## One read, one analysis
 *
 * Deriving the template already decides which design each slide belongs to, so
 * the layout of every imported slide comes free (EXP-5) — it is never guessed
 * a second time. Content mapping is deterministic on top of that: the slide
 * already says what it holds.
 *
 * ## Safety
 *
 * The template is written first and the lecture second, so a failure part way
 * through leaves a template and no half-lecture; the deck is rolled back with
 * `deleteDeckCascade` exactly as a YAML import is. Existing data is never
 * touched — every write is to a fresh document. The source presentation is
 * only ever read (P-5).
 */
import { z } from 'zod'
import type {
  DeckImportFromSlidesResult,
  GenerationProvider,
  Layout,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  projectOwner,
  requiresGoogleDrive,
  type ProjectAccess,
  type WithGoogle,
} from './access'
import { registerAction } from './dispatch'
import { requireImportVolume } from '../billing/meter-hooks'
import {
  importPresentation,
  importSourcePresentation,
  assetPrefix,
} from '../import/import-presentation'
import { mockPresentation } from '../import/mock-presentation'
import { isLive } from '../lib/export-mode'
import { decryptToken } from '../lib/token-crypto'
import { accessTokenFor } from '../auth/google-connect'
import { registry } from '../providers/registry'
import { layoutSchema, normalizeSlot } from '../templates/builtin'
import { permalinkSlug } from '../lib/slug'
import { currentVersionIdFor } from '../templates/versions'
import { TemplateModel, toTemplateDto } from '../models/template'
import { DeckModel, resolveDeckAcl, toDeckDto } from '../models/deck'
import { SlideModel } from '../models/slide'
import { deleteDeckCascade } from '../lib/cascade'

export const deckImportFromSlides = defineAction<
  { projectId: string; presentationId: string; keepEverySlide?: boolean },
  DeckImportFromSlidesResult,
  WithGoogle<ProjectAccess>
>({
  name: 'deck.importFromSlides',
  // The lecture does not exist yet, so what is authorized is the project it
  // lands in — owner only, matching deck.create and deck.import. Reading the
  // presentation needs the same Drive grant the design import uses.
  access: requiresGoogleDrive(
    projectOwner((input: { projectId: string }) => input.projectId),
    'export',
  ),
  meter: requireImportVolume,
  input: z.object({
    projectId: z.string().min(1),
    presentationId: z.string().trim().min(1).max(120),
    /** One layout per slide rather than the few designs the deck is built
     * from (TMPL-8). The author's choice, carried through. */
    keepEverySlide: z.boolean().optional(),
  }),
  execute: async (_ctx, input, { project, userId, googleUser: user }) => {
    const provider = registry.get<GenerationProvider>('generation')

    // The connected account comes from the access check, which loaded it with
    // the refresh token. Reading the user again here returned a document
    // without one — the field is `select: false`, so it is absent unless asked
    // for — and decrypting `undefined` is what failed every live import.
    const imported = isLive()
      ? await importPresentation({
          accessToken: await accessTokenFor(
            decryptToken(user.googleQuizRefreshToken!),
          ),
          presentationId: input.presentationId,
          ownerId: userId,
          provider,
          ...(input.keepEverySlide ? { keepEverySlide: true } : {}),
        })
      : await importSourcePresentation(mockPresentation(input.presentationId), {
          provider,
          assetPrefix: assetPrefix(userId, input.presentationId),
          ...(input.keepEverySlide ? { keepEverySlide: true } : {}),
        })

    // The design, saved exactly as a template-only import saves it: an author
    // may keep only this and discard the lecture (EXP-5).
    const layouts = z.array(layoutSchema).parse(imported.template.layouts)
    const templateDoc = await TemplateModel.create({
      ownerId: userId,
      name: imported.template.name,
      permalinkSlug: permalinkSlug(imported.template.name, 'template'),
      renderMode: imported.template.renderMode,
      theme: imported.template.theme,
      // Slots arrive in the file's shorthand or object form; normalizing on
      // save means every reader downstream sees one shape (as template.ts).
      layouts: layouts.map(layout => ({
        ...layout,
        slots: layout.slots.map(normalizeSlot),
      })) as Layout[],
      visibility: 'private',
    })
    const template = toTemplateDto(templateDoc)

    const title = imported.template.name
    const deck = await DeckModel.create({
      projectId: project._id,
      ownerId: userId,
      title,
      // Named by its source rather than by the AI, the way a titled YAML
      // import is: the instructor already called this deck something.
      titleLocked: true,
      templateId: template.id,
      // Pinned as it stands at import (TMPL-11).
      templateVersionId: await currentVersionIdFor(template.id),
      permalinkSlug: permalinkSlug(title || 'untitled'),
      slideOrder: [],
    })

    try {
      const order: string[] = []
      for (let i = 0; i < imported.slides.length; i++) {
        const source = imported.slides[i]!
        const slide = await SlideModel.create({
          deckId: deck._id,
          index: i,
          // The layout the design analysis assigned — not re-guessed (EXP-5).
          layoutType: source.layoutType,
          slots: source.slots,
          ...(source.sourceTranscript
            ? { sourceTranscript: source.sourceTranscript }
            : {}),
        })
        order.push(slide._id.toString())
      }
      deck.slideOrder = order
      await deck.save()
    } catch (err) {
      // No half-lecture left behind. The template stands: it is a deliverable
      // in its own right and nothing about it failed.
      await deleteDeckCascade(deck).catch(() => {})
      throw err
    }

    const acl = resolveDeckAcl(deck, project)
    return { deck: toDeckDto(deck, acl), template, report: imported.report }
  },
})

registerAction(deckImportFromSlides)
