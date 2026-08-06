/**
 * Public deck viewer route (SHARE-1): GET /api/decks/:slug. Access
 * follows the deck ACL (visibility + shared viewers/editors, optional
 * auth); missing and forbidden are both 404 so existence never leaks.
 * The one exception is an allowlisted admin: admins may always open a
 * lecture read-only (the ADMIN_EMAILS gate is the authorization, as on
 * the admin API). canEdit tells the client whether to enable the
 * editing surface.
 *
 * POST /api/decks/:slug/translation (SHARE-2) serves the same deck's slide
 * content in another language, behind the same view gate: translated reading
 * is part of viewing a lecture, so it is open to the anonymous permalink
 * visitors the feature exists for.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import type { HydratedDocument } from 'mongoose'
import {
  deckSourceLocale,
  isLocale,
  type DeckTranslationResponse,
  type DeckViewResponse,
} from '@slide-machine/shared'
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
import { translateSlides, translationEnabled } from '../lib/translate-slides'
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

/**
 * Loads the deck behind a permalink and enforces the viewer ACL, or throws
 * 404 — missing and forbidden look identical so existence never leaks. Shared
 * by the view and translate routes so both gate viewing the same way.
 */
const loadViewableDeck = async (
  slug: string,
  userId: string | undefined,
): Promise<HydratedDocument<DeckDb>> => {
  const notFound = new HttpError(404, 'not_found', 'Deck not found')
  const deck = await DeckModel.findOne({ permalinkSlug: slug })
  if (!deck) throw notFound
  const acl = await loadDeckAcl(deck)
  if (!canViewAcl(acl, userId)) {
    // Admin view bypass: allowlisted admins may always open a lecture
    // (read-only — canEdit still follows the ACL)
    if (!(await isAllowlistedAdmin(userId))) throw notFound
  }
  return deck
}

decksRouter.get('/decks/:slug', optionalAuth, async (req, res) => {
  const notFound = new HttpError(404, 'not_found', 'Deck not found')

  const deck = await loadViewableDeck(String(req.params.slug), req.userId)
  const acl = await loadDeckAcl(deck)

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

/**
 * POST /api/decks/:slug/translation — the deck's slide content in another
 * language (SHARE-2).
 *
 * Gated on VIEW access, not edit and not sign-in: reading a shared lecture in
 * your own language is part of viewing it, and the students this exists for
 * arrive through a permalink without an account. Results are cached per deck +
 * locale, so this is usually a database read; only new or edited slides reach
 * the paid API.
 */
decksRouter.post('/decks/:slug/translation', optionalAuth, async (req, res) => {
  if (!translationEnabled()) {
    throw new HttpError(
      503,
      'unavailable',
      'Translation is not configured on this server',
    )
  }
  const locale = req.body?.locale
  if (!isLocale(locale)) {
    throw new HttpError(400, 'bad_request', 'Unsupported language')
  }

  const deck = await loadViewableDeck(String(req.params.slug), req.userId)
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  const source = deckSourceLocale(deck.language, project?.language)

  const body: DeckTranslationResponse = { locale, source, perSlide: {} }
  // Asking for the language it is already in is not an error, just a no-op:
  // the viewer renders the authored text and nothing is spent.
  if (locale === source) return res.json(body)

  const slides = await SlideModel.find({ deckId: deck._id }).sort({ index: 1 })
  try {
    body.perSlide = await translateSlides(
      deck._id,
      slides.map(toSlideDto),
      source,
      locale,
    )
  } catch {
    // The provider failed or timed out. Report it as an upstream failure so
    // the viewer can fall back to the original text rather than showing a
    // half-translated deck.
    throw new HttpError(
      502,
      'translation_failed',
      'Could not translate this lecture right now',
    )
  }
  res.json(body)
})
