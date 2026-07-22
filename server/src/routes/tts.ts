/**
 * Text-to-speech synthesis for slide/deck playback. `POST /api/slides/:id/tts`
 * returns a `{ url }` to an MP3/WAV the client plays:
 *  - mode 'content'    → speaks the slide's rendered content (kebab "Speak this slide")
 *  - mode 'transcript' → speaks the slide's stored transcript (whole-deck play);
 *    when the slide has no transcript, Gemini narrates its content first.
 *
 * Synthesized audio is cached in object storage under a content hash, so
 * replays are free and never re-call the paid APIs. View access (not edit) is
 * enough to listen. Synthesis is behind the vendor-neutral TtsProvider.
 */
import { createHash } from 'node:crypto'
import { Router } from 'express'
import { findTtsVoice, type TtsProvider } from '@slide-machine/shared'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { SlideModel } from '../models/slide'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { privateViewGrantee } from '../models/admin-private-access'
import { ProjectModel } from '../models/project'
import { canViewAcl } from '../lib/access'
import { slideContentText } from '../lib/speakable-text'
import { narrateSlide } from '../tts/narrate'
import { registry } from '../providers/registry'
import { getStorage } from '../storage'
import { env } from '../config/env'

export const ttsRouter = Router()

/** File extension for a provider's audio, for cache-key + /api/files serving. */
const extensionFor = (mimeType: string): string =>
  mimeType === 'audio/wav' ? 'wav' : 'mp3'

ttsRouter.post('/slides/:slideId/tts', requireAuth, async (req, res) => {
  const slideId = String(req.params.slideId)
  const mode = req.body?.mode === 'transcript' ? 'transcript' : 'content'

  const slide = await SlideModel.findById(slideId).catch(() => null)
  if (!slide) throw new HttpError(404, 'not_found', 'Slide not found')
  const deck = await DeckModel.findById(slide.deckId).catch(() => null)
  if (!deck) throw new HttpError(403, 'forbidden', 'Not allowed')
  const acl = await loadDeckAcl(deck)
  if (!canViewAcl(acl, req.userId)) {
    // Narration is part of viewing: honor the admin private-view grant
    // (the deck view itself is what the audit log records)
    const admin = await privateViewGrantee(req.userId, acl.ownerId)
    if (!admin) throw new HttpError(403, 'forbidden', 'Not allowed')
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
  if (mode === 'transcript' && transcript) {
    seed = `transcript|${transcript}`
    resolveText = async () => transcript
  } else if (mode === 'transcript') {
    if (!content) return res.json({ url: null })
    seed = `narrate|${content}`
    resolveText = async () =>
      (await narrateSlide(content, languageCode)) || content
  } else {
    if (!content) return res.json({ url: null })
    seed = `content|${content}`
    resolveText = async () => content
  }

  const provider = registry.get<TtsProvider>('tts')
  const ext = extensionFor(provider.audioMimeType)
  const hash = createHash('sha256')
    .update(
      [provider.name, languageCode, voiceName ?? '', gender ?? '', seed].join(
        ' ',
      ),
    )
    .digest('hex')
  const storageKey = `tts/${hash}.${ext}`
  const storage = getStorage()

  // Cache hit → serve the stored audio; no synthesis.
  if (await storage.get(storageKey)) {
    return res.json({ url: storage.publicUrl(storageKey) })
  }

  const text = await resolveText()
  if (!text.trim()) return res.json({ url: null })
  const audio = await provider.synthesize({
    text,
    languageCode,
    voiceName,
    gender,
  })
  await storage.put(storageKey, Buffer.from(audio), provider.audioMimeType)
  res.json({ url: storage.publicUrl(storageKey) })
})
