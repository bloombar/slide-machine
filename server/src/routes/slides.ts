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
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { SlideModel, toSlideDto } from '../models/slide'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { SeedAssetModel } from '../models/seed-asset'
import { keywordsFromName } from '../seeding/extract'
import { canEditAcl } from '../lib/access'
import { getStorage } from '../storage'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

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

    slide.imageRef = publicUrl
    // The instructor supplied this image, so it is their own to credit —
    // mark it user-provided (not AI 'stock') so its attribution stays
    // editable, and clear any credit carried over from a replaced image
    slide.imageSource = 'seeded'
    slide.attribution = undefined
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
