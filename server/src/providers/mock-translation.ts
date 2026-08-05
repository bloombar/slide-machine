/**
 * Deterministic mock TranslationProvider (TRANSLATION_PROVIDER=mock) — tags
 * each segment with its target locale instead of calling the paid API, so
 * tests and e2e exercise the whole markdown → html → translate → markdown →
 * cache → render path without a network call or a key.
 *
 * The marker is inserted *inside* any leading markup rather than in front of
 * it, so a translated segment keeps the same tag structure as its source.
 * That is what lets the round-trip and the link-repair logic be tested for
 * real: a mock that returned plain strings would quietly skip both.
 */
import type {
  TranslationInput,
  TranslationProvider,
} from '@slide-machine/shared'
import { registry } from './registry'

/** Matches the run of opening tags a fragment may start with. */
const LEADING_TAGS = /^((?:\s*<[^/][^>]*>)*)/

export class MockTranslationProvider implements TranslationProvider {
  readonly name = 'mock'

  async translate({
    texts,
    target,
    format,
  }: TranslationInput): Promise<string[]> {
    const marker = `[${target}]`
    return texts.map(text => {
      if (!text.trim()) return text
      if (format !== 'html') return `${marker} ${text}`
      return text.replace(LEADING_TAGS, `$1${marker} `)
    })
  }
}

registry.register('translation', 'mock', () => new MockTranslationProvider())
