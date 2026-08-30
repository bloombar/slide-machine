/**
 * Deriving image-search keywords from a slide's own text (EDIT-3 + IMG-1).
 * When a slide is moved onto an image layout but the generation model left
 * it no keywords, we mine its visible text for search terms so enrichment
 * has something to look for. Terms stay individual (never one long phrase):
 * the ranker credits a keyword only when every word in it appears on a
 * candidate, so single salient words match far more readily.
 */
import { env } from '../config/env'

/** Words that never help an image search and only dilute the relevance
 * score. Deliberately small — the real nouns carry the query. */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'into',
  'about',
  'over',
  'under',
  'their',
  'our',
  'your',
  'his',
  'her',
  'they',
  'we',
  'you',
  'how',
  'what',
  'why',
  'when',
  'where',
  'which',
  'who',
  'than',
  'then',
  'so',
  'such',
  'not',
  'no',
  'can',
  'will',
  'vs',
  'via',
  'per',
  'also',
  'more',
  'most',
  'some',
  'any',
  'each',
  'all',
  'both',
])

/** Most keywords kept from one slide: enough to be specific, few enough
 * that a relevant image still clears the ranker's overlap threshold. */
const MAX_KEYWORDS = 6

/** Words per query when the environment states none. */
const DEFAULT_QUERY_WORDS = 2

/**
 * Shortens one search phrase to the words that actually find a picture.
 *
 * Every source matches a multi-word query CONJUNCTIVELY — each extra word is
 * another condition a photo has to satisfy, not a hint about what would be
 * nice. So the phrases the model writes unprompted ("mitochondrion cristae
 * electron transport chain", "burette conical flask titration laboratory
 * setup") describe the slide well and match almost nothing: measured against
 * the real sources, five such phrases returned 2, 24, 0, 0 and 0 usable
 * candidates. Cut to their first two significant words, the same five
 * returned 19, 24, 10, 16 and 4.
 *
 * That is not a speed fix and was never a slow search — the queries above all
 * answered inside a second either way. It is the difference between a picture
 * arriving and the box staying empty while the client polls for one that is
 * never coming, which is what "the images take a long time" turns out to be.
 *
 * Stopwords go first, so "the structure of a chloroplast" spends its two
 * words on "structure chloroplast" rather than on "the structure". A phrase
 * that is nothing but stopwords keeps its own first words instead of coming
 * back empty — a poor query still beats no query.
 */
export const tightenSearchPhrase = (
  phrase: string,
  maxWords: number | undefined = env.IMAGE_MAX_QUERY_WORDS,
): string => {
  // A missing or nonsensical cap must not quietly mean "keep everything".
  // `slice(0, undefined)` returns the whole array, so an unset env var would
  // have turned this function into a no-op that still looked like it ran —
  // the failure would have been an empty picture box, nowhere near here.
  const cap =
    Number.isInteger(maxWords) && (maxWords as number) > 0
      ? (maxWords as number)
      : DEFAULT_QUERY_WORDS
  const words = phrase.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const significant = words.filter(w => !STOPWORDS.has(w.toLowerCase()))
  return (significant.length ? significant : words).slice(0, cap).join(' ')
}

/**
 * Every phrase shortened, blanks and duplicates dropped.
 *
 * Two phrases can collapse onto the same query once their tails are cut
 * ("chloroplast thylakoid membrane" and "chloroplast thylakoid stack" both
 * become "chloroplast thylakoid"), and searching the identical query twice
 * spends a source request to pool results already in the pool.
 */
export const tightenSearchPhrases = (
  phrases: readonly string[],
  maxWords: number | undefined = env.IMAGE_MAX_QUERY_WORDS,
): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const phrase of phrases) {
    const tightened = tightenSearchPhrase(phrase, maxWords)
    const key = tightened.toLowerCase()
    if (!tightened || seen.has(key)) continue
    seen.add(key)
    out.push(tightened)
  }
  return out
}

/** Salient, deduped words from one blob of text, stopwords removed. */
const extractKeywords = (text: string | undefined): string[] => {
  if (!text) return []
  const seen = new Set<string>()
  const words: string[] = []
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    words.push(token)
    if (words.length >= MAX_KEYWORDS) break
  }
  return words
}

/**
 * Keywords for sourcing an image on a slide, preferring the tightest text
 * the slide offers: its title, then its bullets, then its body, then its
 * caption. The first tier that yields any term wins, keeping the query
 * focused.
 *
 * The caption tier is what saves a picture-led layout. `image-heavy`
 * declares an image slot and a caption and nothing else, so a slide on it
 * has no title, bullets or body to mine — without the caption there is
 * nothing to search for, and the slot stays empty for good.
 */
export const deriveImageKeywords = (slide: {
  title?: string
  bullets?: string[]
  body?: string
  caption?: string
}): string[] => {
  const tiers = [
    slide.title,
    slide.bullets?.join(' '),
    slide.body,
    slide.caption,
  ]
  for (const tier of tiers) {
    const words = extractKeywords(tier)
    if (words.length) return words
  }
  return []
}
