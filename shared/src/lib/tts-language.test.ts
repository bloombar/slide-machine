/** Unit tests for narration language tags and voice/language matching. */
import { describe, it, expect } from 'vitest'
import { LOCALES } from '../types/locale'
import { TTS_VOICES } from '../types/tts-voices'
import {
  TTS_LANGUAGE_TAGS,
  baseLanguage,
  ttsLanguageTag,
  voiceMatchesLanguage,
} from './tts-language'

describe('ttsLanguageTag', () => {
  it('qualifies every supported locale', () => {
    for (const locale of LOCALES) {
      expect(ttsLanguageTag(locale)).toBe(TTS_LANGUAGE_TAGS[locale])
      expect(ttsLanguageTag(locale)).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/)
    }
  })

  it('speaks Mandarin as cmn-CN, not the codes the other Google APIs use', () => {
    // Translation wants zh-CN and speech-to-text wants cmn-Hans-CN; sending
    // either one to Cloud TTS is rejected.
    expect(ttsLanguageTag('zh')).toBe('cmn-CN')
    expect(ttsLanguageTag('zh')).not.toBe('zh-CN')
    expect(ttsLanguageTag('zh')).not.toBe('cmn-Hans-CN')
  })

  it('passes an already-qualified tag through untouched', () => {
    // A server that configured TTS_LANGUAGE=en-GB means it.
    expect(ttsLanguageTag('en-GB')).toBe('en-GB')
    expect(ttsLanguageTag('pt-BR')).toBe('pt-BR')
  })
})

describe('baseLanguage', () => {
  it('reduces tags and voice names to their language subtag', () => {
    expect(baseLanguage('en-US')).toBe('en')
    expect(baseLanguage('en-US-Neural2-F')).toBe('en')
    expect(baseLanguage('cmn-CN')).toBe('cmn')
    expect(baseLanguage('fr')).toBe('fr')
  })

  it('is case-insensitive', () => {
    expect(baseLanguage('EN-us')).toBe('en')
  })
})

describe('voiceMatchesLanguage', () => {
  it('matches a bare locale against a fully-qualified voice name', () => {
    // The bug this fixes: a lecture declaring `language: 'en'` used to fail
    // this comparison and silently lose its chosen voice.
    expect(voiceMatchesLanguage('en-US-Neural2-F', 'en')).toBe(true)
    expect(voiceMatchesLanguage('en-US-Neural2-F', 'en-US')).toBe(true)
    expect(voiceMatchesLanguage('en-US-Neural2-F', 'en-GB')).toBe(true)
  })

  it('rejects a voice from another language', () => {
    expect(voiceMatchesLanguage('en-US-Neural2-F', 'fr-FR')).toBe(false)
    expect(voiceMatchesLanguage('en-US-Chirp3-HD-Aoede', 'cmn-CN')).toBe(false)
  })

  it('matches a same-language voice whatever its region', () => {
    expect(voiceMatchesLanguage('cmn-CN-Wavenet-A', 'cmn-CN')).toBe(true)
  })

  it('keeps every catalog voice on the English tag and off the others', () => {
    for (const voice of TTS_VOICES) {
      expect(voiceMatchesLanguage(voice.voiceName, ttsLanguageTag('en'))).toBe(
        true,
      )
      expect(voiceMatchesLanguage(voice.voiceName, ttsLanguageTag('fr'))).toBe(
        false,
      )
    }
  })
})
