/**
 * Deriving image-search keywords from a slide's own text (EDIT-3 + IMG-1).
 * When a slide is moved onto an image layout but the generation model left
 * it no keywords, we mine its visible text for search terms so enrichment
 * has something to look for. Terms stay individual (never one long phrase):
 * the ranker credits a keyword only when every word in it appears on a
 * candidate, so single salient words match far more readily.
 */

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
