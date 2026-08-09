/**
 * Language tags for narration, and whether a catalog voice belongs to one.
 *
 * The app stores languages as bare `Locale` subtags ('en', 'fr', …) but speech
 * APIs want region-qualified BCP-47, and each Google service qualifies them
 * differently — Mandarin above all:
 *
 *   - Translation wants `zh-CN`     (providers/google-cloud-translation.ts)
 *   - Speech-to-Text wants `cmn-Hans-CN` (providers/google-cloud-transcription.ts)
 *   - Text-to-Speech wants `cmn-CN`      (here)
 *
 * Three maps, deliberately not one: they are three vendors' vocabularies that
 * happen to overlap, and collapsing them would make the next disagreement a
 * silent mistranslation rather than a compile error.
 */
import type { Locale } from '../types/locale'

/** The tag the TTS adapter speaks each locale in. */
export const TTS_LANGUAGE_TAGS: Record<Locale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  ru: 'ru-RU',
  zh: 'cmn-CN',
}

/**
 * The language tag to synthesize in. Values that are already qualified (a
 * server's `TTS_LANGUAGE` of 'en-GB', say) pass through untouched, so an
 * operator's choice is never rewritten into something they did not ask for.
 */
export const ttsLanguageTag = (language: string): string =>
  TTS_LANGUAGE_TAGS[language as Locale] ?? language

/**
 * The base subtag of a language tag or a provider voice name — 'en-US' and
 * 'en-US-Neural2-F' are both 'en'. What makes a voice comparable to a language
 * without either side having to be written the same way.
 */
export const baseLanguage = (tag: string): string =>
  tag.toLowerCase().split('-')[0] ?? ''

/**
 * Whether a catalog voice can speak a language. Compared by base subtag: the
 * catalog names voices in full ('en-US-Neural2-F') while a lecture may declare
 * its language as either 'en' or 'en-US', and all three mean the same thing.
 */
export const voiceMatchesLanguage = (
  voiceName: string,
  languageCode: string,
): boolean => baseLanguage(voiceName) === baseLanguage(languageCode)
