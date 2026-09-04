/**
 * Public deck viewer route (SHARE-1): GET /api/decks/:slug. Access
 * follows the deck ACL (visibility + shared viewers/editors, optional
 * auth); missing and forbidden are both 404 so existence never leaks.
 * The one exception is an allowlisted admin: admins may always open a
 * lecture read-only (the ADMIN_EMAILS gate is the authorization, as on
 * the admin API), including one that has been soft-deleted, which every
 * other reader is refused (ADMIN-6 — the opening is audited). canEdit
 * tells the client whether to enable the editing surface.
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
import {
  adminViewer,
  asOf,
  logDeletedView,
  withDeleted,
  type AdminViewer,
} from '../lib/admin-view'
import { canEditAcl, canViewAcl } from '../lib/access'
import { SlideModel, toSlideDto } from '../models/slide'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { resolveDeckTemplateForRead } from '../templates/versions'
import { translateSlides, translationEnabled } from '../lib/translate-slides'
import { translationBillingFor } from '../billing/translation-usage'
import { attributionForDeck } from '../billing/attribution-resolve'
import { runWithUsage } from '../billing/usage-context'
import { PlanLimitExceededError } from '../billing/limits'
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
 *
 * Returns the acting admin alongside the deck when an allowlisted admin got
 * in on the bypass rather than on the ACL, so the caller can audit what the
 * bypass exposed. A soft-deleted lecture is nowhere to be found for anyone
 * else; for an admin it resolves like a live one (ADMIN-6).
 */
const loadViewableDeck = async (
  slug: string,
  userId: string | undefined,
): Promise<{ deck: HydratedDocument<DeckDb>; admin: AdminViewer | null }> => {
  const notFound = new HttpError(404, 'not_found', 'Deck not found')
  const live = await DeckModel.findOne({ permalinkSlug: slug })
  if (live) {
    const acl = await loadDeckAcl(live)
    if (canViewAcl(acl, userId)) return { deck: live, admin: null }
    // Admin view bypass: allowlisted admins may always open a lecture
    // (read-only — canEdit still follows the ACL)
    const admin = await adminViewer(userId)
    if (!admin) throw notFound
    return { deck: live, admin }
  }
  // Nothing live under this slug. It may still name a tombstoned lecture,
  // which only an admin may open — and only until the retention sweep
  // purges it.
  const admin = await adminViewer(userId)
  if (!admin) throw notFound
  const deck = await DeckModel.findOne({ permalinkSlug: slug }).setOptions(
    withDeleted,
  )
  if (!deck) throw notFound
  return { deck, admin }
}

decksRouter.get('/decks/:slug', optionalAuth, async (req, res) => {
  const notFound = new HttpError(404, 'not_found', 'Deck not found')

  const { deck, admin } = await loadViewableDeck(
    String(req.params.slug),
    req.userId,
  )
  // A tombstoned lecture reads through its own cascade: its slides, its
  // project and its owner all went away with it, so they are resolved with
  // tombstones visible (ADMIN-6). Opening it is audited — one entry per
  // opening, as for an admin's view of private content.
  const { filter, options } = asOf(deck.deletedAt)
  const parents = deck.deletedAt ? withDeleted : {}
  const acl = await loadDeckAcl(deck, { withDeleted: Boolean(deck.deletedAt) })

  const template = await resolveDeckTemplateForRead(deck)
  if (!template) throw notFound

  const isOwner = acl.ownerId === req.userId
  const canEdit = canEditAcl(acl, req.userId)
  const slides = await SlideModel.find({ deckId: deck._id, ...filter })
    .sort({ index: 1 })
    .setOptions(options)
  const project = await ProjectModel.findById(deck.projectId)
    .setOptions(parents)
    .catch(() => null)
  // Owner (SOC-4 link) and the viewer's own vote on this lecture (SOC-1).
  const owner = await UserModel.findById(deck.ownerId)
    .select('displayName')
    .setOptions(parents)
    .catch(() => null)
  if (deck.deletedAt && admin) {
    await logDeletedView(
      admin,
      'deck.deleted_view',
      'deck',
      deck._id.toString(),
      {
        title: deck.title,
        ownerId: deck.ownerId.toString(),
        deletedAt: deck.deletedAt.toISOString(),
      },
    )
  }
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
  // The shared shape drops the study label (EVAL-3), but an admin opening
  // another user's settings needs the current value — re-attach it for any
  // allowlisted admin, checking only when there is a label to reveal.
  const deckDto = isOwner ? toDeckDto(deck, acl) : toSharedDeckDto(deck, acl)
  if (!isOwner && deck.studyLabel && (admin || (await adminViewer(req.userId))))
    deckDto.studyLabel = deck.studyLabel
  const body: DeckViewResponse = {
    deck: deckDto,
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

  // Switching language inside a lecture already opened is not a second
  // opening, so a tombstoned one is served here without another audit entry
  // — the view that got the admin here logged it.
  const { deck } = await loadViewableDeck(String(req.params.slug), req.userId)
  const { filter, options } = asOf(deck.deletedAt)
  const parents = deck.deletedAt ? withDeleted : {}
  const project = await ProjectModel.findById(deck.projectId)
    .setOptions(parents)
    .catch(() => null)
  const source = deckSourceLocale(deck.language, project?.language)

  const body: DeckTranslationResponse = { locale, source, perSlide: {} }
  // Asking for the language it is already in is not an error, just a no-op:
  // the viewer renders the authored text and nothing is spent.
  if (locale === source) return res.json(body)

  // Whoever asked, the owner's plan pays (BILL-3) — but an owner or editor
  // preparing the lecture draws on a different allowance than a student
  // reading it, so who triggered this decides the pool before anything else.
  const acl = await loadDeckAcl(deck, { withDeleted: Boolean(deck.deletedAt) })
  const actor = canEditAcl(acl, req.userId) ? 'author' : 'audience'
  const billing = await translationBillingFor(acl.ownerId, actor)
  // Who pays, who asked, what for, and in which language (BILL-7). The
  // metering lives several layers down inside `translateSlides`, which knows
  // about decks and languages but nothing about requests, so the context has
  // to be established here or the row lands with none: charged to the right
  // account, but attributed to the system, on no lecture, in no language.
  // `audience` is stated rather than inferred because the case this most has
  // to get right is the student without an account, who has no id to compare.
  const attribution = attributionForDeck(acl.ownerId, deck, {
    actorId: req.userId,
    audience: actor === 'audience',
    locale,
  })

  const slides = await SlideModel.find({ deckId: deck._id, ...filter })
    .sort({ index: 1 })
    .setOptions(options)
  try {
    const perSlide = await runWithUsage(attribution, () =>
      translateSlides(
        deck._id,
        slides.map(toSlideDto),
        source,
        locale,
        billing,
      ),
    )
    // Narration rides in the same entries (PLAY-3) but is not part of reading:
    // it is fetched when someone actually presses play, and shipping it here
    // would put a second copy of every transcript on the wire for every viewer.
    body.perSlide = Object.fromEntries(
      Object.entries(perSlide).map(([slideId, { slots, sourceHash }]) => [
        slideId,
        { slots, sourceHash },
      ]),
    )
  } catch (error) {
    // An exhausted allowance is not an upstream failure: it is a deliberate
    // refusal with its own status and its own message, and rewriting it as a
    // 502 would tell the reader to retry something that cannot succeed.
    if (error instanceof PlanLimitExceededError) throw error
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
