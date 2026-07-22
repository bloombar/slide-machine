/**
 * Public deck viewer route (SHARE-1): GET /api/decks/:slug. Access
 * follows the deck ACL (visibility + shared viewers/editors, optional
 * auth); missing and forbidden are both 404 so existence never leaks.
 * The one exception is an allowlisted admin holding a private-view
 * grant for the lecture's owner (the audited toggle on the admin user
 * page) — each such view is recorded in the admin action log. canEdit
 * tells the client whether to enable the editing surface.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import type { HydratedDocument } from 'mongoose'
import type { DeckViewResponse } from '@slide-machine/shared'
import {
  DeckModel,
  loadDeckAcl,
  toDeckDto,
  toSharedDeckDto,
  type DeckDb,
} from '../models/deck'
import { privateViewGrantee } from '../models/admin-private-access'
import { logAdminAction } from '../audit/log'
import { canEditAcl, canViewAcl } from '../lib/access'
import { SlideModel, toSlideDto } from '../models/slide'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { getBuiltinTemplate } from '../templates/builtin'
import { verifyAccessToken } from '../auth/tokens'
import { ProjectModel } from '../models/project'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'

/** Attaches userId when a valid Bearer token is present; never rejects. */
const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      req.userId = (
        await verifyAccessToken(header.slice('Bearer '.length))
      ).userId
    } catch {
      // Anonymous access is fine here; invalid tokens are simply ignored
    }
  }
  next()
}

/**
 * Slide ids whose original lecture audio can be played back: a timed transcript
 * segment of the slide belongs to a recording still retained on the deck.
 * Returns [] for non-editors — the audio holds student voices.
 */
const playableAudioSlideIds = async (
  deck: HydratedDocument<DeckDb>,
  canEdit: boolean,
): Promise<string[]> => {
  const sessionIds = (deck.recordings ?? []).map(r => r.sessionId)
  if (!canEdit || !sessionIds.length) return []
  const ids = await TranscriptSegmentModel.find({
    deckId: deck._id,
    slideId: { $ne: null },
    sessionId: { $in: sessionIds },
    startMs: { $ne: null },
  }).distinct('slideId')
  return ids.map(id => String(id))
}

export const decksRouter = Router()

decksRouter.get('/decks/:slug', optionalAuth, async (req, res) => {
  const notFound = new HttpError(404, 'not_found', 'Deck not found')

  const deck = await DeckModel.findOne({
    permalinkSlug: String(req.params.slug),
  })
  if (!deck) throw notFound
  const acl = await loadDeckAcl(deck)
  if (!canViewAcl(acl, req.userId)) {
    // Admin private-view bypass: only for an allowlisted admin who has
    // enabled the grant for this lecture's owner, and every use lands
    // in the audit log
    const admin = await privateViewGrantee(req.userId, acl.ownerId)
    if (!admin) throw notFound
    await logAdminAction({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'deck.private_view',
      targetType: 'deck',
      targetId: deck._id.toString(),
      details: { title: deck.title, ownerId: acl.ownerId },
    })
  }

  const template = getBuiltinTemplate(deck.templateId)
  if (!template) throw notFound

  const isOwner = acl.ownerId === req.userId
  const canEdit = canEditAcl(acl, req.userId)
  const slides = await SlideModel.find({ deckId: deck._id }).sort({ index: 1 })
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  const body: DeckViewResponse = {
    deck: isOwner ? toDeckDto(deck, acl) : toSharedDeckDto(deck, acl),
    slides: slides.map(toSlideDto),
    template,
    canEdit,
    projectGenerationFreedom:
      project?.generationFreedom ?? env.GENERATION_FREEDOM,
    projectLanguage: project?.language ?? undefined,
    projectTtsVoice: project?.ttsVoice ?? undefined,
    // Slides with playable retained audio (editors only — it holds student
    // voices). A slide qualifies if a timed segment of it belongs to a
    // recording that is still retained on the deck.
    audioSlideIds: await playableAudioSlideIds(deck, canEdit),
  }
  res.json(body)
})
