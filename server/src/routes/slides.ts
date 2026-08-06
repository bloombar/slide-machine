/**
 * Slide image upload (EDIT-1): POST /api/slides/:slideId/image with a
 * multipart image replaces (or sets) that slide's picture. The file lands
 * in storage the same way seed images do, and the slide's imageRef points
 * at its public URL. Removing an image goes through slide.editContent
 * (imageRef ''), so only the upload needs a dedicated route. Edit rights
 * follow the slide's deck.
 */
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import type { HydratedDocument } from 'mongoose'
import type {
  ImageAttribution,
  ImageSearchCandidate,
  ImageSource,
} from '@slide-machine/shared'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { SlideModel, toSlideDto, type SlideDb } from '../models/slide'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { buildSlideAudio, slideAudioWav } from '../lib/slide-audio'
import { SeedAssetModel } from '../models/seed-asset'
import { keywordsFromName } from '../seeding/extract'
import { searchImageCandidates } from '../enrichment/search'
import { assertUserCapacity } from '../billing/meter-hooks'
import { runWithUsage } from '../billing/usage-context'
import { canEditAcl } from '../lib/access'
import { getStorage } from '../storage'
import { patchSlot, slotsOf } from '../lib/slide-slots'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

/**
 * Where an image lands on a slide. A layout may declare several image slots
 * (TMPL-9), so the request names the one it means; without a name it is the
 * conventional `image` slot.
 */
const setSlotImage = (
  slide: HydratedDocument<SlideDb>,
  slot: string | undefined,
  value: {
    imageRef: string
    imageSource: ImageSource
    attribution?: ImageAttribution
  },
) => {
  slide.slots = patchSlot(slotsOf(slide), slot || 'image', {
    kind: 'image',
    ref: value.imageRef,
    source: value.imageSource,
    attribution: value.attribution,
  })
  slide.markModified('slots')
}

/** The slot an image request names, if any. */
const requestedSlot = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 60)
    : undefined

export const slidesRouter = Router()

slidesRouter.post(
  '/slides/:slideId/image',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const file = req.file
    if (!file) throw new HttpError(400, 'bad_request', 'No file uploaded')
    if (!IMAGE_TYPES.has(file.mimetype)) {
      throw new HttpError(
        400,
        'unsupported_type',
        'Only PNG, JPEG, and WebP images are accepted',
      )
    }

    const slide = await SlideModel.findById(req.params.slideId).catch(
      () => null,
    )
    if (!slide) throw new HttpError(404, 'not_found', 'Slide not found')

    const deck = await DeckModel.findById(slide.deckId).catch(() => null)
    if (!deck || !canEditAcl(await loadDeckAcl(deck), req.userId)) {
      throw new HttpError(403, 'forbidden', 'Not allowed')
    }

    const name = (file.originalname || 'image').replace(/[^\w.-]+/g, '_')
    const storage = getStorage()
    const key = `slides/${slide._id.toString()}/${randomUUID()}-${name}`
    await storage.put(key, file.buffer, file.mimetype)
    const publicUrl = storage.publicUrl(key)

    // The instructor supplied this image, so it is their own to credit —
    // mark it user-provided (not AI 'stock') so its attribution stays
    // editable, and clear any credit carried over from a replaced image
    setSlotImage(slide, requestedSlot(req.body?.slot), {
      imageRef: publicUrl,
      imageSource: 'seeded',
      attribution: undefined,
    })
    await slide.save()

    // Also register the upload as lecture seed material (SEED-2), so it
    // appears under Seed material and can be reused by generation. The
    // image itself is already stored; the record points at the same file.
    // Best-effort: a hiccup here must not fail the image replace.
    try {
      await SeedAssetModel.create({
        projectId: deck.projectId,
        deckId: slide.deckId,
        type: 'image',
        name,
        status: 'ready',
        imageUrl: publicUrl,
        storageKey: key,
        keywords: keywordsFromName(name),
      })
    } catch (error) {
      console.warn(
        'Slide image saved but seed-material registration failed:',
        error,
      )
    }

    res.status(201).json(toSlideDto(slide))
  },
)

/** Loads a slide the caller may edit (via its deck ACL), or throws. */
const loadEditableSlide = async (slideId: string, userId?: string) => {
  const slide = await SlideModel.findById(slideId).catch(() => null)
  if (!slide) throw new HttpError(404, 'not_found', 'Slide not found')
  const deck = await DeckModel.findById(slide.deckId).catch(() => null)
  if (!deck || !canEditAcl(await loadDeckAcl(deck), userId)) {
    throw new HttpError(403, 'forbidden', 'Not allowed')
  }
  return { slide, deck }
}

/** Keeps only non-empty string fields of an attribution, or undefined. */
const compactAttribution = (value: unknown): ImageAttribution | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => typeof v === 'string' && v.trim() !== '',
  )
  return entries.length
    ? (Object.fromEntries(entries) as ImageAttribution)
    : undefined
}

/**
 * Web image search (EDIT-1): returns candidate images for replacing this
 * slide's picture. An explicit `query` wins; otherwise the AI's own image
 * keywords are used, falling back to the slide title — so results relate
 * to what the slide is about. Sources and credit come from enrichment.
 *
 * Costs one `imageLookups` unit, the same as an automatic enrichment (BILL-3):
 * the searcher does the same work either way. Unlike enrichment this one is
 * refused outright when the allowance is gone (402), because the person asking
 * is sitting in front of the picker waiting for results.
 */
slidesRouter.post(
  '/slides/:slideId/image-candidates',
  requireAuth,
  async (req, res) => {
    const { slide } = await loadEditableSlide(
      String(req.params.slideId),
      req.userId,
    )
    const query: string =
      typeof req.body?.query === 'string' ? req.body.query.trim() : ''
    // A typed query is a COMMA-separated list of phrases: each phrase is
    // searched on its own and the results are pooled and ranked (so one box
    // can search several intents at once). A phrase with no comma is just a
    // single conjunctive query. With no query at all, fall back to the AI's
    // own keyword phrases, then the title — so results relate to the slide.
    const keywords = query
      ? query
          .split(',')
          .map(phrase => phrase.trim())
          .filter(Boolean)
      : slide.imageKeywords?.length
        ? slide.imageKeywords
        : [slide.title].filter((t): t is string => Boolean(t))

    // requireAuth has already established this; the field stays optional on the
    // request type because unauthenticated routes share the same shape.
    const payer = req.userId
    if (!payer) throw new HttpError(401, 'unauthorized', 'Sign in to continue')
    await assertUserCapacity(
      payer,
      'imageLookups',
      'You have used all of this billing period’s image searches. It resets at the start of your next period.',
    )
    const candidates = await runWithUsage(payer, () =>
      searchImageCandidates(keywords),
    )
    const dto: ImageSearchCandidate[] = candidates.map(c => ({
      url: c.url,
      title: c.title,
      source: c.source,
      attribution: c.attribution,
      width: c.width,
      height: c.height,
    }))
    res.json(dto)
  },
)

/**
 * Sets a slide's image to one chosen from web search results (EDIT-1).
 * The picture is hotlinked from its source the same way enrichment does,
 * so it is marked AI-sourced ('stock') with read-only credit carried from
 * the source (IMG-5) — the instructor did not create it.
 */
slidesRouter.post(
  '/slides/:slideId/image-from-source',
  requireAuth,
  async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    if (!/^https?:\/\//i.test(url)) {
      throw new HttpError(400, 'bad_request', 'A valid image URL is required')
    }
    const { slide } = await loadEditableSlide(
      String(req.params.slideId),
      req.userId,
    )
    setSlotImage(slide, requestedSlot(req.body?.slot), {
      imageRef: url,
      imageSource: 'stock',
      attribution: compactAttribution(req.body?.attribution),
    })
    await slide.save()
    res.json(toSlideDto(slide))
  },
)

/**
 * Plays back a slide's original lecture audio (GEN-4): the slide's retained
 * segments stitched into one WAV (see lib/slide-audio, shared with
 * re-transcription). Edit access only — it holds student voices. A 404 means no
 * audio remains for the slide.
 */
slidesRouter.get('/slides/:slideId/audio', requireAuth, async (req, res) => {
  const { slide, deck } = await loadEditableSlide(
    String(req.params.slideId),
    req.userId,
  )
  const audio = await buildSlideAudio(deck, slide)
  if (!audio) {
    throw new HttpError(404, 'not_found', 'No original audio for this slide')
  }
  res.setHeader('Content-Type', 'audio/wav')
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(slideAudioWav(audio))
})
