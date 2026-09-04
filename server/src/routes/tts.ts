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
 * `locale` says which language the slides are being read in (PLAY-3). Narration
 * follows the screen, so it is the only thing the client has to send: the words
 * are the slide's transcript translated (or, for a slide nobody narrated, its
 * translated content), and everything below this point is unchanged. The audio
 * cache needs nothing translation-specific, because the language and the spoken
 * words already identify a clip.
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
  deckSourceLocale,
  findTtsVoice,
  isLocale,
  localeOfTtsTag,
  overlaySlideTranslation,
  ttsLanguageTag,
  voiceMatchesLanguage,
  type Locale,
  type TtsMark,
  type TtsProvider,
} from '@slide-machine/shared'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { SlideModel, toSlideDto } from '../models/slide'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { asOf, isAllowlistedAdmin } from '../lib/admin-view'
import { ProjectModel } from '../models/project'
import { canEditAcl, canViewAcl } from '../lib/access'
import { slideContentText } from '../lib/speakable-text'
import { slotsOf } from '../lib/slide-slots'
import { translateSlides, translationEnabled } from '../lib/translate-slides'
import { translateNarration } from '../lib/translate-narration'
import { translationBillingFor } from '../billing/translation-usage'
import { PlanLimitExceededError } from '../billing/limits'
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
import { attributionForDeck } from '../billing/attribution-resolve'

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
  // The language the slides are being read in (PLAY-3). Narration follows the
  // screen, so this is the only thing the client has to say about it.
  const requestedLocale: unknown = req.body?.locale
  if (requestedLocale !== undefined && !isLocale(requestedLocale)) {
    throw new HttpError(400, 'bad_request', 'Unsupported language')
  }

  // Admins may open a soft-deleted lecture in the viewer (ADMIN-6), so its
  // narration has to resolve too — otherwise the lecture is half-readable.
  // Only a miss pays for the admin check, so the ordinary play stays one
  // lookup. The opening is audited by the view that got the admin here; a
  // play is not a second opening.
  let admin = false
  let slide = await SlideModel.findById(slideId).catch(() => null)
  if (!slide) {
    admin = await isAllowlistedAdmin(req.userId)
    if (!admin) throw new HttpError(404, 'not_found', 'Slide not found')
    slide = await SlideModel.findById(slideId)
      .setOptions({ withDeleted: true })
      .catch(() => null)
    if (!slide) throw new HttpError(404, 'not_found', 'Slide not found')
  }
  const deck = await DeckModel.findById(slide.deckId)
    .setOptions({ withDeleted: admin })
    .catch(() => null)
  if (!deck) throw new HttpError(403, 'forbidden', 'Not allowed')
  const acl = await loadDeckAcl(deck, { withDeleted: admin })
  // Speaking supplied words is an edit-side preview, so it takes edit rights —
  // no admin/view bypass. Everything else is part of viewing the lecture.
  if (supplied !== null) {
    if (!canEditAcl(acl, req.userId)) {
      throw new HttpError(403, 'forbidden', 'Not allowed')
    }
  } else if (!canViewAcl(acl, req.userId)) {
    // Narration is part of viewing: admins may always listen, matching
    // the viewer bypass in routes/decks.ts
    if (!admin && !(await isAllowlistedAdmin(req.userId))) {
      throw new HttpError(403, 'forbidden', 'Not allowed')
    }
  }

  const project = await ProjectModel.findById(deck.projectId)
    .setOptions({ withDeleted: admin })
    .catch(() => null)

  // The language the lecture was authored in — what "Original" means for it.
  const sourceLocale = deckSourceLocale(deck.language, project?.language)
  // Reading in another language only means something when translation is
  // configured (TECH-4) and the language is not the one the lecture already
  // speaks. A preview of unsaved words never carries one: it is an edit-side
  // path, and a translated view is read-only even for editors (SHARE-2).
  const target: Locale | undefined =
    requestedLocale !== undefined &&
    requestedLocale !== sourceLocale &&
    supplied === null &&
    translationEnabled()
      ? requestedLocale
      : undefined

  // Language cascade: the language being read wins, then the lecture's own
  // setting, then its project's, then the server default. Locales are stored
  // as bare subtags and speech APIs want region-qualified tags, so they are
  // mapped on the way out (`ttsLanguageTag` passes a qualified tag through, so
  // a server that configured TTS_LANGUAGE=en-GB keeps it).
  const declared = deck.language ?? project?.language
  const languageCode = ttsLanguageTag(target ?? declared ?? env.TTS_LANGUAGE)
  /**
   * The language actually spoken, for the ledger (BILL-7).
   *
   * It has to follow the same cascade the synthesis above does. `sourceLocale`
   * does not: `deckSourceLocale` ends at English, while synthesis ends at
   * `TTS_LANGUAGE`, so on a deployment that set that to anything else a deck
   * declaring no language was spoken in one language and recorded as another.
   *
   * The server default is a tag, so it is read back through the same table
   * that produced it — not through its base subtag, which would answer 'cmn'
   * for Mandarin and so fail on the one language this field exists to count.
   * A tag naming no language this app has leaves the field unset, which the
   * ledger already means as "no language": better silent than confidently
   * English about narration that was not.
   */
  const spokenLocale =
    target ?? declared ?? localeOfTtsTag(env.TTS_LANGUAGE) ?? undefined

  // Voice cascade: the lecture's own setting wins, then its project's, then the
  // server default (TTS_DEFAULT_VOICE); an unset default leaves `voice`
  // undefined, so the provider uses its own default voice for the language.
  const voice = findTtsVoice(
    deck.ttsVoice ?? project?.ttsVoice ?? env.TTS_DEFAULT_VOICE,
  )
  // Use the chosen voice by name only when it belongs to the language being
  // spoken; otherwise its gender carries across to a same-gender voice in that
  // language (the voice's gender was recorded with the selection). Compared by
  // base subtag, because the catalog names voices in full ('en-US-Neural2-F')
  // while a lecture may declare its language as either 'en' or 'en-US'.
  const gender = voice?.gender
  const voiceName =
    voice && voiceMatchesLanguage(voice.voiceName, languageCode)
      ? voice.voiceName
      : undefined
  // Speak in the voice's own tag when one is named: a provider rejects a voice
  // whose language does not match what it was asked to say (an 'en-US' voice
  // sent with 'en-GB'). Without a name, the requested language stands.
  const spokenLanguage = voiceName
    ? voiceName.split('-').slice(0, 2).join('-')
    : languageCode

  // Whoever asked, the owner's plan pays (BILL-1) — but an owner or editor
  // preparing the deck draws on a different allowance than someone listening to
  // it. Decided before any paid work, because a cache hit is still recorded and
  // has to land on the same metric a miss would have.
  const actor = canEditAcl(acl, req.userId) ? 'author' : 'audience'
  // Who pays, who asked, and what for (BILL-7). This is the path where payer
  // and actor genuinely differ — a student's playback is charged to the deck's
  // owner — and the one where the actor may be nobody at all, since a shared
  // lecture is played by people without accounts. `audience` is stated rather
  // than inferred, so an anonymous listener is still recorded as audience
  // activity instead of being mistaken for the owner's own work.
  const attribution = attributionForDeck(acl.ownerId, deck, {
    actorId: req.userId,
    audience: actor === 'audience',
    // The language actually heard (PLAY-3). Always a language, unlike the
    // translation side — every playback is in some language, and recording
    // only the translated ones would leave the original-language plays as an
    // unlabelled remainder rather than a count.
    locale: spokenLocale,
  })
  // Translating the narration is translation work, charged to the same owner
  // out of the same two pools as translated reading (BILL-3, SHARE-2).
  const translationBilling = target
    ? await translationBillingFor(acl.ownerId, actor)
    : undefined

  const transcript = slide.sourceTranscript?.trim()

  /**
   * The slide's content as it is being displayed — the authored text, or the
   * translation laid over it when the deck is being read in another language.
   * Loads the whole deck because `translateSlides` writes `perSlide` from the
   * slides it is handed and drops the rest, so a one-slide call would delete
   * every other slide's cached translation. It is normally a pure cache hit:
   * the viewer already translated this deck to put it on screen.
   */
  const displayedContent = async (): Promise<string> => {
    if (!target) return slideContentText(slide)
    const { filter, options } = asOf(deck.deletedAt)
    const slides = await SlideModel.find({ deckId: deck._id, ...filter })
      .sort({ index: 1 })
      .setOptions(options)
    const perSlide = await translateSlides(
      deck._id,
      slides.map(toSlideDto),
      sourceLocale,
      target,
      translationBilling,
    )
    return slideContentText(
      overlaySlideTranslation(
        {
          title: slide.title,
          body: slide.body,
          bullets: slide.bullets,
          caption: slide.caption,
          slots: slotsOf(slide),
        },
        perSlide[slideId],
      ),
    )
  }

  /** What to speak, and how to produce it once the audio cache has missed. */
  interface Speech {
    seed: string
    resolveText: () => Promise<string>
  }

  /**
   * What the deck says in the language it is being read in (PLAY-3).
   *
   * Translation is the one thing that cannot stay lazy: the audio cache key IS
   * the spoken words, so they have to be known before it is consulted. That is
   * a database read on a replay, not a paid call — the narration cache sits in
   * the same per-deck + locale entry as the slide text — and it is recorded at
   * zero. The alternative, putting the locale in the key as a namespace, would
   * give up the sharing that makes two lectures saying the same words in the
   * same language cost one stored object.
   */
  const translatedSpeech = async (locale: Locale): Promise<Speech | null> => {
    // The lecturer's own words, translated.
    if (mode === 'transcript' && transcript) {
      const spoken = await runWithUsage(attribution, () =>
        translateNarration(
          deck._id,
          slideId,
          transcript,
          sourceLocale,
          locale,
          translationBilling,
        ),
      )
      return { seed: `transcript|${spoken}`, resolveText: async () => spoken }
    }
    // Nothing was said about this slide, so it is narrated from its translated
    // content — the way PLAY-2 narrates from content in the original language.
    const translated = await runWithUsage(attribution, displayedContent)
    if (!translated) return null
    return mode === 'transcript'
      ? {
          seed: `narrate|${translated}`,
          resolveText: async () =>
            (await narrateSlide(translated, languageCode)) || translated,
        }
      : {
          seed: `content|${translated}`,
          resolveText: async () => translated,
        }
  }

  // A stable cache seed (independent of any non-deterministic narration) plus
  // a lazy text resolver, so a cache hit never re-narrates or re-synthesizes.
  let speech: Speech
  if (supplied !== null) {
    // Exactly what the caller typed — no narration, no fallback to content: a
    // preview that spoke something else would be worthless.
    const preview = supplied.trim()
    if (!preview) return res.json({ url: null, marks: [] })
    // Same seed shape as a stored transcript, on purpose: previewing text and
    // then saving and playing it share one cache entry, so the preview costs
    // the paid API nothing the eventual playback wasn't going to cost anyway.
    speech = { seed: `transcript|${preview}`, resolveText: async () => preview }
  } else if (target) {
    let translated: Speech | null
    try {
      translated = await translatedSpeech(target)
    } catch (error) {
      // An exhausted allowance is a deliberate refusal with its own status
      // (BILL-4), not an upstream failure — rewriting it as a 502 would tell
      // the listener to retry something that cannot succeed.
      if (error instanceof PlanLimitExceededError) throw error
      // Reported rather than papered over: speaking the original language into
      // a translated deck would have a student reading French and hearing
      // English, with nothing on screen to explain why.
      throw new HttpError(
        502,
        'translation_failed',
        'Could not narrate this lecture in that language right now',
      )
    }
    if (!translated) return res.json({ url: null, marks: [] })
    speech = translated
  } else {
    const content = slideContentText(slide)
    if (mode === 'transcript' && transcript) {
      speech = {
        seed: `transcript|${transcript}`,
        resolveText: async () => transcript,
      }
    } else if (!content) {
      return res.json({ url: null, marks: [] })
    } else if (mode === 'transcript') {
      speech = {
        seed: `narrate|${content}`,
        resolveText: async () =>
          (await narrateSlide(content, languageCode)) || content,
      }
    } else {
      speech = { seed: `content|${content}`, resolveText: async () => content }
    }
  }
  const { seed, resolveText } = speech

  const provider = registry.get<TtsProvider>('tts')
  const ext = extensionFor(provider.audioMimeType)
  // `v2` bumps the cache namespace so entries synthesized before `<mark>`
  // timepoints regenerate with a marks sidecar.
  const hash = createHash('sha256')
    .update(
      [
        'v2',
        provider.name,
        spokenLanguage,
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
    // the denominator of every per-viewer average (BILL-7). Zero units, not a
    // character count: on the narrate path the synthesized text is precisely
    // what a cache hit avoids producing, so no honest quantity is available
    // here. The ledger will need one; the row that says "this happened" does
    // not.
    //
    // No owner lookup, unlike the miss path below: this is the hot path, and a
    // row against a since-deleted owner is harmless when it is never debited.
    await runWithUsage(attribution, () =>
      recordUsage(acl.ownerId, ttsMetricFor(actor, premium), 0, {
        billable: false,
      }),
    )
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
    ? await runWithUsage(attribution, resolveText)
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
    await runWithUsage(attribution, () =>
      recordUsage(
        acl.ownerId,
        ttsMetricFor(actor, premium),
        billedCharacters ?? text.length,
      ),
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
