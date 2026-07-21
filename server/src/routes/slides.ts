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
import type {
  ImageAttribution,
  ImageSearchCandidate,
} from '@slide-machine/shared'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { SlideModel, toSlideDto } from '../models/slide'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { pcmToWav } from '../lib/wav'
import { SeedAssetModel } from '../models/seed-asset'
import { keywordsFromName } from '../seeding/extract'
import { searchImageCandidates } from '../enrichment/search'
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

    const candidates = await searchImageCandidates(keywords)
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
    slide.imageRef = url
    slide.imageSource = 'stock'
    slide.attribution = compactAttribution(req.body?.attribution)
    await slide.save()
    res.json(toSlideDto(slide))
  },
)

// A retained session WAV is exactly pcmToWav(pcm, rate): a canonical 44-byte
// header followed by 16-bit mono little-endian PCM (2 bytes/sample).
const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2
// Word-end timestamps tend to land slightly before the sound actually stops, so
// each segment's tail is extended by this much (clamped to the recording) to
// avoid clipping the last word.
const TAIL_PAD_MS = 400

/**
 * Plays back a slide's original lecture audio (GEN-4): stitches the retained
 * recording audio for each of the slide's timed transcript segments, in speech
 * order, into one WAV. Edit access only — it holds student voices. Segments
 * whose recording has aged out are skipped; a 404 means none remain.
 */
slidesRouter.get('/slides/:slideId/audio', requireAuth, async (req, res) => {
  const { slide, deck } = await loadEditableSlide(
    String(req.params.slideId),
    req.userId,
  )
  // The recording (audio blob) still retained for each session, by sessionId.
  const recBySession = new Map(
    (deck.recordings ?? []).map(r => [r.sessionId, r]),
  )
  const segments = await TranscriptSegmentModel.find({
    deckId: deck._id,
    slideId: slide._id,
    startMs: { $ne: null },
  }).sort({ createdAt: 1 })

  const storage = getStorage()
  const wavCache = new Map<string, Buffer | null>()
  const slices: Buffer[] = []
  let sampleRate = 0
  for (const seg of segments) {
    const rec = seg.sessionId ? recBySession.get(seg.sessionId) : undefined
    if (!rec) continue
    if (!wavCache.has(rec.audioKey))
      wavCache.set(rec.audioKey, await storage.get(rec.audioKey))
    const wav = wavCache.get(rec.audioKey)
    if (!wav) continue

    // Segment times are session-absolute ms into this recording's PCM body.
    const pcm = wav.subarray(WAV_HEADER_BYTES)
    const toByte = (ms: number): number =>
      Math.max(
        0,
        Math.min(Math.floor((ms / 1000) * rec.sampleRate) * BYTES_PER_SAMPLE, pcm.length),
      )
    const start = toByte(seg.startMs as number)
    // Pad the tail so the last word is never cut off (clamped in toByte).
    const end =
      seg.endMs != null ? toByte(seg.endMs + TAIL_PAD_MS) : pcm.length
    if (end > start) {
      slices.push(pcm.subarray(start, end))
      if (!sampleRate) sampleRate = rec.sampleRate
    }
  }

  if (!slices.length) {
    throw new HttpError(404, 'not_found', 'No original audio for this slide')
  }
  res.setHeader('Content-Type', 'audio/wav')
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(pcmToWav(Buffer.concat(slices), sampleRate))
})
