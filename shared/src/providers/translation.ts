/**
 * TranslationProvider — text in one language out in another (SPEC TECH-8).
 * Backs the post-lecture translated viewing of slide content (SHARE-2), so
 * the translator can be swapped for another vendor, or a locally-hosted
 * model, without touching the viewer, the cache, or the exports.
 *
 * Translation is a batch operation on purpose: one deck's slides are one
 * call, which is both far faster and far cheaper than a call per field.
 * Adapters must return one result per input, in the same order.
 */
import type { Locale } from '../types/locale'

export interface TranslationInput {
  /** Segments to translate, in order. HTML fragments when `format` is 'html'. */
  texts: string[]
  /** The language the texts are in; omitted lets the provider detect it. */
  source?: Locale
  target: Locale
  /**
   * 'html' keeps inline markup intact — the translator moves the tags with
   * the words they wrap, which plain text cannot express. Slide content uses
   * it; anything already plain uses 'text'.
   */
  format: 'text' | 'html'
}

export interface TranslationProvider {
  readonly name: string
  /** Returns one translation per input text, in the same order. */
  translate(input: TranslationInput): Promise<string[]>
}
