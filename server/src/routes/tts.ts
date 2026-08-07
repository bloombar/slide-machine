/**
 * Text-to-speech synthesis for slide/deck playback. `POST /api/slides/:id/tts`
 * returns a `{ url }` to an MP3/WAV the client plays:
 *  - mode 'content'    → speaks the slide's rendered content (kebab "Speak this slide")
 *  - mode 'transcript' → speaks the slide's stored transcript (whole-deck play);
 *    when the slide has no transcript, Gemini narrates its content first.
 *  - `text` supplied  → speaks exactly that instead, so the transcript editor can
 *    preview an unsaved narration (EDIT-6). This one needs EDIT access: it
 *    synthesizes caller-supplied words rather than what the lecture already
 *    says, and only someone who could save those words may spend the API call
 *    on them.
 *
 * Synthesized audio is cached in object storage under a content hash, so
 * replays are free and never re-call the paid APIs. View access (not edit) is
 * enough to listen to what a lecture already says. Synthesis is behind the
 * vendor-neutral TtsProvider.
 *
 * Because that hash covers only what was spoken, two lectures narrating the
 * same words in the same voice share one object. Every playback therefore
 * records the deck against it (`retainTtsObject`), so the retention purge can
 * tell a file its last lecture has left from one another lecture still plays
 * (P-11).
 *
 * Synthesis is metered against the **deck owner's** plan, never the caller's
 * (BILL-1/BILL-3): a listener spends the owner's audience allowance, an owner
 * or editor spends the authoring one. Only cache misses count — audio that
 * already exists keeps playing after a cap is reached, so students never lose
 * access to material that was already paid for.
 */
import { createHash } from 'node:crypto'
import { Router } from 'express'
import {
  findTtsVoice,
  type TtsMark,
  type TtsProvider,
} from '@slide-machine/shared'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { SlideModel } from '../models/slide'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { isAllowlistedAdmin } from '../lib/admin-view'
import { ProjectModel } from '../models/project'
import { canEditAcl, canViewAcl } from '../lib/access'
import { slideContentText } from '../lib/speakable-text'
import { narrateSlide } from '../tts/narrate'
import { registry } from '../providers/registry'
import { getStorage } from '../storage'
import { env } from '../config/env'
import { UserModel } from '../models/user'
import { retainTtsObject, ttsStorageKeys } from '../models/tts-object'
import { assertTtsCapacity, ttsMetricFor } from '../billing/tts-usage'
import { effectivePlanTier, PLAN_FIELDS } from '../billing/plan-grant'
import { recordUsage } from '../billing/usage'
import { runWithUsage } from '../billing/usage-context'

export const ttsRouter = Router()

/** File extension for a provider's audio, for cache-key + /api/files serving. */
const extensionFor = (mimeType: string): string =>
  mimeType === 'audio/wav' ? 'wav' : 'mp3'

/** Cap on previewed text, matching slide.editTranscript's transcript cap: a
 * preview can never be longer than the narration it is a preview of. */
const MAX_PREVIEW_CHARS = 20000

ttsRouter.post('/slides/:slideId/tts', requireAuth, async (req, res) => {
  const slideId = String(req.params.slideId)
  const mode = req.body?.mode === 'transcript' ? 'transcript' : 'content'
  // Caller-supplied narration to speak instead of the slide's own (EDIT-6).
  const supplied = typeof req.body?.text === 'string' ? req.body.text : null
  if (supplied !== null && supplied.length > MAX_PREVIEW_CHARS) {
    throw new HttpError(
      400,
      'bad_request',
      'That narration is too long to speak',
    )
  }

  const slide = await SlideModel.findById(slideId).catch(() => null)
  if (!slide) throw new HttpError(404, 'not_found', 'Slide not found')
  const deck = await DeckModel.findById(slide.deckId).catch(() => null)
  if (!deck) throw new HttpError(403, 'forbidden', 'Not allowed')
  const acl = await loadDeckAcl(deck)
  // Speaking supplied words is an edit-side preview, so it takes edit rights —
  // no admin/view bypass. Everything else is part of viewing the lecture.
  if (supplied !== null) {
    if (!canEditAcl(acl, req.userId)) {
      throw new HttpError(403, 'forbidden', 'Not allowed')
    }
  } else if (!canViewAcl(acl, req.userId)) {
    // Narration is part of viewing: admins may always listen, matching
    // the viewer bypass in routes/decks.ts
    if (!(await isAllowlistedAdmin(req.userId))) {
      throw new HttpError(403, 'forbidden', 'Not allowed')
    }
  }

  // Language + voice cascade: the lecture's own setting wins, then its
  // project's, then the server default (all inherited from the same fields the
  // rest of the app uses).
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  const languageCode = deck.language ?? project?.language ?? env.TTS_LANGUAGE
  // Voice cascade: the lecture's own setting wins, then its project's, then the
  // server default (TTS_DEFAULT_VOICE); an unset default leaves `voice`
  // undefined, so the provider uses its own default voice for the language.
  const voice = findTtsVoice(
    deck.ttsVoice ?? project?.ttsVoice ?? env.TTS_DEFAULT_VOICE,
  )
  // Use the chosen voice by name only when it belongs to the lecture's
  // language; otherwise its gender carries across to a same-gender voice in
  // that language (the voice's gender was recorded with the selection).
  const gender = voice?.gender
  const voiceLanguage = voice?.voiceName.split('-').slice(0, 2).join('-')
  const voiceName =
    voice && voiceLanguage?.toLowerCase() === languageCode.toLowerCase()
      ? voice.voiceName
      : undefined

  const content = slideContentText(slide)
  const transcript = slide.sourceTranscript?.trim()

  // A stable cache seed (independent of any non-deterministic narration) plus
  // a lazy text resolver, so a cache hit never re-narrates or re-synthesizes.
  let seed: string
  let resolveText: () => Promise<string>
  if (supplied !== null) {
    // Exactly what the caller typed — no narration, no fallback to content: a
    // preview that spoke something else would be worthless.
    const preview = supplied.trim()
    if (!preview) return res.json({ url: null, marks: [] })
    // Same seed shape as a stored transcript, on purpose: previewing text and
    // then saving and playing it share one cache entry, so the preview costs
    // the paid API nothing the eventual playback wasn't going to cost anyway.
    seed = `transcript|${preview}`
    resolveText = async () => preview
  } else if (mode === 'transcript' && transcript) {
    seed = `transcript|${transcript}`
    resolveText = async () => transcript
  } else if (mode === 'transcript') {
    if (!content) return res.json({ url: null, marks: [] })
    seed = `narrate|${content}`
    resolveText = async () =>
      (await narrateSlide(content, languageCode)) || content
  } else {
    if (!content) return res.json({ url: null, marks: [] })
    seed = `content|${content}`
    resolveText = async () => content
  }

  const provider = registry.get<TtsProvider>('tts')
  const ext = extensionFor(provider.audioMimeType)
  // `v2` bumps the cache namespace so entries synthesized before `<mark>`
  // timepoints regenerate with a marks sidecar.
  const hash = createHash('sha256')
    .update(
      [
        'v2',
        provider.name,
        languageCode,
        voiceName ?? '',
        gender ?? '',
        seed,
      ].join(' '),
    )
    .digest('hex')
  const { storageKey, marksKey } = ttsStorageKeys(hash, ext)
  const storage = getStorage()

  /**
   * Claims this object for the slide's deck, so the purge knows the lecture
   * plays it (P-11). Best-effort: an unrecorded reference costs a file that
   * outlives the lecture it belonged to, which is never worth failing a
   * playback over.
   */
  const retain = async (): Promise<void> => {
    try {
      await retainTtsObject({ storageKey, marksKey }, slide.deckId)
    } catch (error) {
      console.warn('TTS reference not recorded:', error)
    }
  }

  // Whoever asked, the owner's plan pays (BILL-1) — but an owner or editor
  // preparing the deck draws on a different allowance than someone listening
  // to it. Decided before the cache is consulted, because a cache hit is still
  // recorded and has to land on the same metric a miss would have.
  const actor = canEditAcl(acl, req.userId) ? 'author' : 'audience'
  // Premium only when the premium voice is really the one being sent: a voice
  // whose language does not match the lecture's is dropped in favour of the
  // provider's own default, which is a standard one.
  const premium = voiceName !== undefined && voice?.tier === 'premium'

  // Cache hit → serve the stored audio + its marks sidecar; no synthesis. Marks
  // derive purely from (text, voice), so they cache alongside the audio and are
  // never invalidated by whiteboard edits.
  if (await storage.get(storageKey)) {
    const marksBuf = await storage.get(marksKey)
    const marks: TtsMark[] = marksBuf ? JSON.parse(marksBuf.toString()) : []
    // Recorded, never debited (BILL-3). Serving stored audio costs nothing, but
    // the playback still happened — and the count of students who listened is
    // the denominator of every per-student average (BILL-7). Zero units, not a
    // character count: on the narrate path the synthesized text is precisely
    // what a cache hit avoids producing, so no honest quantity is available
    // here. The ledger will need one; the row that says "this happened" does
    // not.
    //
    // No owner lookup, unlike the miss path below: this is the hot path, and a
    // row against a since-deleted owner is harmless when it is never debited.
    await recordUsage(acl.ownerId, ttsMetricFor(actor, premium), 0, {
      billable: false,
    })
    // A hit is how a second deck comes to share audio a first one paid for, so
    // this is the reference that keeps the file alive past the first deck's
    // deletion.
    await retain()
    return res.json({ url: storage.publicUrl(storageKey), marks })
  }

  // Cache miss: this call will spend money, so the owner's allowance decides
  // whether it happens.
  const owner = await UserModel.findById(acl.ownerId)
    .select(PLAN_FIELDS)
    .catch(() => null)
  // An ownerless deck is not billable to anyone — its owner's account is gone,
  // so there is no allowance to check and nothing to debit.
  if (owner) {
    await assertTtsCapacity(
      acl.ownerId,
      effectivePlanTier(owner),
      actor,
      premium,
    )
  }

  // Narration of a transcript-less slide calls Gemini, so the owner pays for
  // those tokens too — the ambient context is how the adapter attributes them.
  const text = owner
    ? await runWithUsage(acl.ownerId, resolveText)
    : await resolveText()
  if (!text.trim()) return res.json({ url: null, marks: [] })
  const { audio, marks, billedCharacters } = await provider.synthesize({
    text,
    languageCode,
    voiceName,
    gender,
  })
  // Metered after the fact: only a synthesis that produced audio is charged,
  // and the adapter reports what it was actually billed for rather than the
  // caller guessing from the plain text.
  if (owner) {
    await recordUsage(
      acl.ownerId,
      ttsMetricFor(actor, premium),
      billedCharacters ?? text.length,
    )
  }
  await storage.put(storageKey, Buffer.from(audio), provider.audioMimeType)
  await storage.put(
    marksKey,
    Buffer.from(JSON.stringify(marks)),
    'application/json',
  )
  await retain()
  res.json({ url: storage.publicUrl(storageKey), marks })
})
