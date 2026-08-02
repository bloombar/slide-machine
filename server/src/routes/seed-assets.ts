/**
 * Seed-material upload (SEED-1/SEED-2): POST /api/seed-assets with a
 * multipart file plus projectId (and deckId for lecture-level assets).
 * The original lands in storage, the asset record answers immediately
 * as 'processing', and extraction continues in the background — the
 * client polls the list until it settles. Project-level uploads are
 * owner-only; lecture-level ones follow deck edit rights.
 */
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import type { SeedAsset } from '@slide-machine/shared'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { ProjectModel, projectAcl } from '../models/project'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { canEditAcl } from '../lib/access'
import { SeedAssetModel, toSeedAssetDto } from '../models/seed-asset'
import { assertUserCapacity } from '../billing/meter-hooks'
import { BYTES_PER_MB, recordUsage } from '../billing/usage'
import { getStorage } from '../storage'
import { processSeedAsset, keywordsFromName } from '../seeding/extract'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const ACCEPTED: Record<string, SeedAsset['type']> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'doc',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

export const seedAssetsRouter = Router()

seedAssetsRouter.post(
  '/seed-assets',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const file = req.file
    if (!file) throw new HttpError(400, 'bad_request', 'No file uploaded')
    const type = ACCEPTED[file.mimetype]
    if (!type) {
      throw new HttpError(
        400,
        'unsupported_type',
        'Only PDF, DOCX, PNG, JPEG, and WebP files are accepted',
      )
    }

    const projectId = String(req.body.projectId ?? '')
    const deckId = req.body.deckId ? String(req.body.deckId) : undefined
    const forbidden = new HttpError(403, 'forbidden', 'Not allowed')

    if (deckId) {
      const deck = await DeckModel.findById(deckId).catch(() => null)
      if (!deck || !canEditAcl(await loadDeckAcl(deck), req.userId))
        throw forbidden
      if (deck.projectId.toString() !== projectId) throw forbidden
    } else {
      const project = await ProjectModel.findById(projectId).catch(() => null)
      if (!project || !canEditAcl(projectAcl(project), req.userId))
        throw forbidden
    }

    // Charged before the bytes are stored and extracted, so an exhausted
    // allowance costs neither storage nor an extraction pass (BILL-4). The
    // uploader pays rather than the project's owner: they chose to spend it,
    // and it is the same account the extraction's AI tokens are charged to.
    const payer = req.userId
    if (!payer) throw new HttpError(401, 'unauthorized', 'Sign in to continue')
    await assertUserCapacity(
      payer,
      'importMb',
      'You have used all of this billing period’s import allowance. It resets at the start of your next period.',
    )
    await recordUsage(payer, 'importMb', file.size / BYTES_PER_MB)

    const name = file.originalname || 'upload'
    const asset = await SeedAssetModel.create({
      projectId,
      deckId,
      type,
      name,
      status: 'processing',
      keywords: type === 'image' ? keywordsFromName(name) : [],
    })

    // Keep the original: images serve from here; docs allow reprocessing
    const storage = getStorage()
    const key = `seed/${asset._id.toString()}/${randomUUID()}-${name.replace(/[^\w.-]+/g, '_')}`
    await storage.put(key, file.buffer, file.mimetype)
    asset.storageKey = key
    if (type === 'image') asset.imageUrl = storage.publicUrl(key)
    await asset.save()

    res.status(201).json(toSeedAssetDto(asset))

    void processSeedAsset(asset._id.toString(), file.buffer, file.mimetype)
  },
)
