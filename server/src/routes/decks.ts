/**
 * Public deck viewer route (SHARE-1): GET /api/decks/:slug. Access
 * follows the deck ACL (visibility + shared viewers/editors, optional
 * auth); missing and forbidden are both 404 so existence never leaks.
 * The one exception is an allowlisted admin: admins may always open a
 * lecture read-only (the ADMIN_EMAILS gate is the authorization, as on
 * the admin API). canEdit tells the client whether to enable the
 * editing surface.
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
import { isAllowlistedAdmin } from '../lib/admin-view'
import { canEditAcl, canViewAcl } from '../lib/access'
import { SlideModel, toSlideDto } from '../models/slide'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { resolveTemplateForRead } from '../templates/resolve'
import { verifyAccessToken } from '../auth/tokens'
import { ProjectModel } from '../models/project'
import { UserModel } from '../models/user'
import { VoteModel, voteBreakdown } from '../models/vote'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'
import type { MyVote } from '@slide-machine/shared'

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
    // Admin view bypass: allowlisted admins may always open a lecture
    // (read-only — canEdit below still follows the ACL)
    if (!(await isAllowlistedAdmin(req.userId))) throw notFound
  }

  const template = await resolveTemplateForRead(deck.templateId)
  if (!template) throw notFound

  const isOwner = acl.ownerId === req.userId
  const canEdit = canEditAcl(acl, req.userId)
  const slides = await SlideModel.find({ deckId: deck._id }).sort({ index: 1 })
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  // Owner (SOC-4 link) and the viewer's own vote on this lecture (SOC-1).
  const owner = await UserModel.findById(deck.ownerId)
    .select('displayName')
    .catch(() => null)
  const myVote: MyVote = req.userId
    ? ((
        await VoteModel.findOne({
          userId: req.userId,
          targetType: 'deck',
          targetId: deck._id,
        })
      )?.value ?? 0)
    : 0
  const { up: voteUp, down: voteDown } = await voteBreakdown('deck', deck._id)
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
    owner: {
      id: deck.ownerId.toString(),
      displayName: owner?.displayName ?? '',
    },
    project: { id: deck.projectId.toString(), title: project?.title ?? '' },
    myVote,
    voteUp,
    voteDown,
  }
  res.json(body)
})
