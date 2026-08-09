/**
 * Narration translation for hearing a deck in the language it is being read in
 * (PLAY-3).
 *
 * A read-through cache like `translate-slides.ts`, sharing its collection, its
 * provider and its billing helpers — but a different pipeline, which is why it
 * is a different module. A stored transcript is raw speech: one string, no slot
 * map, and no Markdown, so none of the HTML round trip that slide text needs
 * applies to it. Running it through that conversion would read stray asterisks
 * as emphasis and hand the synthesizer tags to say out loud.
 *
 * It is fingerprinted apart from slide content, and cached in the same per-deck
 * + locale entry, so correcting a spoken transcript (EDIT-6) re-translates that
 * narration on its next play while the deck's slide text — already paid for —
 * is left alone.
 */
import { createHash } from 'node:crypto'
import type { Types } from 'mongoose'
import type { Locale, TranslationProvider } from '@slide-machine/shared'
import { registry } from '../providers/registry'
import {
  assertTranslationCapacity,
  recordCachedTranslation,
  recordTranslationUsage,
  type TranslationBilling,
} from '../billing/translation-usage'
import { SlideTranslationModel } from '../models/slide-translation'

/**
 * Bumped when the narration pipeline changes in a way that makes stored
 * translations wrong. Kept apart from `translate-slides`' own version so that
 * bumping one does not re-pay for the other.
 */
const HASH_VERSION = 'v1'

/**
 * Fingerprint of the transcript a cached narration was translated from.
 *
 * Covers the words and nothing else — not the slide's id, its slots or its
 * layout — because none of those change what a lecturer said.
 */
export const narrationSourceHash = (transcript: string): string =>
  createHash('sha256')
    .update(JSON.stringify([HASH_VERSION, transcript]))
    .digest('hex')

/**
 * The slide's narration in `target`, translating only when the transcript has
 * changed since it was last done.
 *
 * `billing` names who pays and out of which pool (BILL-3), and is optional for
 * the same reasons it is in `translateSlides`: a deck whose owner is gone has
 * no allowance to check, and metering must never be why a caller cannot use
 * this. Throws `PlanLimitExceededError` when the allowance is spent; lets the
 * provider's own failure through, for the caller to report.
 */
export const translateNarration = async (
  deckId: Types.ObjectId,
  slideId: string,
  transcript: string,
  source: Locale,
  target: Locale,
  billing?: TranslationBilling,
): Promise<string> => {
  const existing = await SlideTranslationModel.findOne({
    deckId,
    locale: target,
  })
  const entry = existing?.perSlide?.get(slideId)
  const hash = narrationSourceHash(transcript)

  // Already translated, and the transcript has not changed since. Recorded at
  // zero so a class listening to a lecture that has been spoken once still
  // shows up in the counts without debiting anything (BILL-3/BILL-7).
  if (entry?.narrationHash === hash && entry.narration) {
    if (billing) await recordCachedTranslation(billing)
    return entry.narration
  }

  // Checked at the last moment before the call that spends money. The audience
  // side only ever refuses a language nobody has asked for yet, so a student
  // playing a deck they are already reading in French is never blocked.
  const localeIsNew = !existing
  if (billing) await assertTranslationCapacity(billing, { localeIsNew })

  const provider = registry.get<TranslationProvider>('translation')
  const [translated] = await provider.translate({
    texts: [transcript],
    source,
    target,
    format: 'text',
  })
  // After the fact, like every other metric: only a call that returned is
  // charged, and for what was actually submitted.
  if (billing) {
    await recordTranslationUsage(billing, {
      characters: transcript.length,
      localeIsNew,
    })
  }

  // A translator that returns nothing must not silence the slide — speak the
  // lecturer's own words instead. Deliberately not cached: storing them would
  // pin the wrong language in place until the transcript was next edited.
  const text = translated?.trim()
  if (!text) return transcript

  // A targeted write, so it cannot clobber the slot translations sitting beside
  // it in this entry — unlike `translateSlides`, which rewrites `perSlide`
  // wholesale. Slide ids are ObjectId hex, so they are safe in a dotted path.
  //
  // An upsert here can create an entry that holds narration and no `sourceHash`;
  // that reads as content-stale and translates on the next view, which is right.
  await SlideTranslationModel.updateOne(
    { deckId, locale: target },
    {
      $set: {
        [`perSlide.${slideId}.narration`]: text,
        [`perSlide.${slideId}.narrationHash`]: hash,
      },
    },
    { upsert: true },
  )
  return text
}
