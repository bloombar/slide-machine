/**
 * Public deck viewer route (SHARE-1): GET /api/decks/:slug. Access
 * follows the deck ACL (visibility + shared viewers/editors, optional
 * auth); missing and forbidden are both 404 so existence never leaks.
 * canEdit tells the client whether to enable the editing surface.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import type { DeckViewResponse } from '@slide-machine/shared'
import {
  DeckModel,
  loadDeckAcl,
  toDeckDto,
  toSharedDeckDto,
} from '../models/deck'
import { canEditAcl, canViewAcl } from '../lib/access'
import { SlideModel, toSlideDto } from '../models/slide'
import { getBuiltinTemplate } from '../templates/builtin'
import { verifyAccessToken } from '../auth/tokens'
import { ProjectModel } from '../models/project'
import { env } from '../config/env'
import { UserModel } from '../models/user'
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

export const decksRouter = Router()

decksRouter.get('/decks/:slug', optionalAuth, async (req, res) => {
  const notFound = new HttpError(404, 'not_found', 'Deck not found')

  const deck = await DeckModel.findOne({
    permalinkSlug: String(req.params.slug),
  })
  if (!deck) throw notFound
  const acl = await loadDeckAcl(deck)
  if (!canViewAcl(acl, req.userId)) throw notFound

  const template = getBuiltinTemplate(deck.templateId)
  if (!template) throw notFound

  const isOwner = acl.ownerId === req.userId
  const slides = await SlideModel.find({ deckId: deck._id }).sort({ index: 1 })
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  // Lecture ?? project ?? viewer profile; absent = the browser decides
  // (the client falls back to navigator.language for STT)
  const viewer = req.userId
    ? await UserModel.findById(req.userId).catch(() => null)
    : null
  const body: DeckViewResponse = {
    deck: isOwner ? toDeckDto(deck, acl) : toSharedDeckDto(deck, acl),
    slides: slides.map(toSlideDto),
    template,
    canEdit: canEditAcl(acl, req.userId),
    projectGenerationFreedom:
      project?.generationFreedom ?? env.GENERATION_FREEDOM,
    effectiveLanguage:
      deck.language ?? project?.language ?? viewer?.language ?? undefined,
  }
  res.json(body)
})
