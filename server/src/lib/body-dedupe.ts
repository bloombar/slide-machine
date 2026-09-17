/**
 * GEN-8: a delta update's body is meant to ADD material, not resend it. The
 * model sometimes echoes the current slide's body verbatim, echoes it and
 * then keeps going, or folds an already-said sentence into otherwise-new
 * material. Left in, `updateOverflows` (slide-fit.ts) would count that text
 * against the layout's budget a second time — it is already counted in the
 * slide's current character total — and an additive append would print it
 * twice on the slide. `dropRepeatedBody` is the single entry point deck.ts
 * calls before either of those happens.
 */

/** Sentence-ending punctuation, Latin and CJK. A run of these counts as ONE
 * terminator ("?!" or "..." ends a sentence once, not per character). */
const TERMINATOR_CHARS = '.!?。！？'

/**
 * GEN-8: normalizes a sentence of body prose for duplicate comparison —
 * trimmed, lowercased, internal whitespace collapsed, and trailing sentence
 * punctuation dropped (same spirit as `normalizedBullet` in deck.ts,
 * extended to what a re-sent paragraph varies on: a rephrased space run or
 * an added period should still count as the same sentence).
 */
const normalizedSentence = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`[${TERMINATOR_CHARS}]+$`), '')

/** A CJK character (Han, Hiragana/Katakana, Hangul, and CJK compatibility
 * forms) — scripts that don't separate words with spaces, so a word COUNT
 * is meaningless for them (any run of them is "one word" by that measure). */
const CJK_CHAR = /[぀-ヿ㐀-鿿가-힣豈-﫿]/

/**
 * A sentence fragment substantial enough to trust as a genuine repeat.
 *
 * The naive split below (any terminator ends a sentence) also fires inside
 * an abbreviation — "e.g." followed by a space reads exactly like a
 * sentence end. That alone would be harmless, EXCEPT the resulting
 * fragments ("For e.g." / "g.") are short enough to coincidentally collide
 * with another short fragment elsewhere, so a tiny non-sentence must never
 * be treated as a match candidate on either side of the comparison. Real
 * sentences comfortably clear both a word count and a character count;
 * requiring BOTH (not either) means a short fragment is never the reason
 * something gets deleted, at the cost of never deduping a genuinely short
 * sentence — the safe side to err on.
 *
 * A script with no spaces (CJK) always looks like "one word" to the count
 * above, so it is judged by characters alone instead, at a lower bar: one
 * CJK character carries far more of a sentence's meaning than one Latin
 * character does — five of them is a complete clause, not a fragment.
 */
const isSubstantialSentence = (text: string): boolean => {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length <= 1 && CJK_CHAR.test(trimmed)) return trimmed.length >= 4
  return words.length >= 3 && trimmed.length >= 12
}

/**
 * Splits `text` into sentence spans by scanning for a terminator run
 * followed by whitespace or the end of the string (so "v2.0" and "e.g."
 * keep their periods — nothing whitespace-like follows them there). Each
 * span is an exact slice of the ORIGINAL string, including whatever
 * separated it from the previous span (its own leading whitespace/newline);
 * concatenating any subset of the returned spans, in order, reproduces
 * exactly the substring they came from — nothing is trimmed, lowercased or
 * rejoined with an invented separator.
 */
const sentenceSpans = (text: string): string[] => {
  const boundary = new RegExp(`[${TERMINATOR_CHARS}]+(?=\\s|$)`, 'g')
  const spans: string[] = []
  let start = 0
  for (const m of text.matchAll(boundary)) {
    const end = m.index + m[0].length
    spans.push(text.slice(start, end))
    start = end
  }
  if (start < text.length) spans.push(text.slice(start))
  return spans
}

/**
 * True when position `pos` in `text` is a genuine place to cut — the end
 * of the string, whitespace, or a sentence terminator that itself ends a
 * clause right there. A CJK terminator always counts (CJK sentences often
 * carry no space after one); a Latin terminator only counts when it is
 * ALSO followed by whitespace/end — otherwise it's a decimal point ("2.5")
 * or an abbreviation ("e.g."), not a boundary. Anything else — a letter, a
 * digit, a comma — means the prefix match landed mid-word or mid-number.
 */
const isBoundaryAt = (text: string, pos: number): boolean => {
  if (pos >= text.length) return true
  const ch = text[pos]!
  if (/\s/.test(ch)) return true
  if ('。！？'.includes(ch)) return true
  if (TERMINATOR_CHARS.includes(ch)) {
    const next = text[pos + 1]
    return next === undefined || /\s/.test(next)
  }
  return false
}

/**
 * If `incoming`'s content begins with the WHOLE of `existing`'s body
 * (normalized for case/whitespace), returns just what comes after —
 * mapped back onto `incoming`'s own original characters, so casing,
 * Markdown and punctuation past the matched prefix survive untouched.
 *
 * This is the delta-with-no-terminator case the sentence split above
 * cannot catch on its own: the model echoed the ENTIRE existing body,
 * verbatim, then kept going, with no ". "/end-of-string boundary marking
 * where the echo stops — a body still mid-thought, or CJK prose that
 * doesn't reliably punctuate at every clause. Returns `incoming` unchanged
 * (the SAME reference) when it is not a match, so the caller can tell
 * nothing happened.
 *
 * Two guards keep this from cutting somewhere that only LOOKS like a
 * repeat:
 * - `existing` must be substantial (`isSubstantialSentence`) — a short
 *   fragment like "Cache" or "A" is too easy to coincidentally start an
 *   unrelated sentence ("Cache invalidation is hard.") that never repeated
 *   anything.
 * - The match must end at a genuine boundary (`isBoundaryAt`) in
 *   `incoming` — otherwise "Supports 5" matches the start of "Supports 50
 *   users." and cuts the number in half, and "Version 2." matches the
 *   start of "Version 2.5 adds streaming support." and cuts the decimal.
 */
const stripRepeatedPrefix = (existing: string, incoming: string): string => {
  if (!isSubstantialSentence(existing)) return incoming
  const normalizeWhole = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, ' ')
  const existingNorm = normalizeWhole(existing).replace(
    new RegExp(`[${TERMINATOR_CHARS}]+$`),
    '',
  )
  if (!existingNorm) return incoming
  const raw = incoming.trimStart()
  if (!normalizeWhole(raw).startsWith(existingNorm)) return incoming

  // Walks the ORIGINAL (internally untouched) string one token at a time —
  // a run of whitespace collapses to a single normalized character, same
  // as `normalizeWhole` does; everything else counts as itself — until
  // enough raw characters have been consumed to account for the matched
  // prefix.
  const tokens = raw.match(/\s+|\S/g) ?? []
  let normalizedLen = 0
  let rawEnd = 0
  for (const token of tokens) {
    if (normalizedLen >= existingNorm.length) break
    rawEnd += token.length
    normalizedLen += 1
  }
  if (!isBoundaryAt(raw, rawEnd)) return incoming
  // The remainder still starts with incoming's OWN copy of whatever
  // terminator ended the echoed prefix (dropped from `existingNorm` above
  // only to make the startsWith check tolerant of a missing/added one) —
  // strip that leftover along with the whitespace after it.
  return raw.slice(rawEnd).replace(new RegExp(`^[\\s${TERMINATOR_CHARS}]+`), '')
}

/**
 * Drops body text already present on the slide from a delta update's
 * incoming body, so it counts once (not twice) toward the layout budget
 * and is never appended a second time. Returns undefined when nothing new
 * remains — a phrase that only restates the slide still updates it
 * (transcript grows), it just contributes no fresh body text.
 *
 * Two passes, in order:
 * 1. Whole-body prefix echo (`stripRepeatedPrefix`) — handles a repeat
 *    with no terminator to anchor a sentence split.
 * 2. Sentence-by-sentence removal — drops any incoming sentence whose
 *    normalized form already appears, substantially, in the existing
 *    body. Sentences are located and removed by SPAN, not by splitting
 *    and rejoining trimmed strings: `incoming` is returned byte-for-byte
 *    unchanged whenever nothing actually matches, so blank lines,
 *    Markdown list markers, decimals, URLs and abbreviations are never
 *    touched.
 */
export const dropRepeatedBody = (
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined => {
  if (!incoming || !existing) return incoming

  const prefixStripped = stripRepeatedPrefix(existing, incoming)
  if (prefixStripped !== incoming) return prefixStripped || undefined

  const existingSentences = new Set(
    sentenceSpans(existing)
      .filter(isSubstantialSentence)
      .map(normalizedSentence),
  )
  if (!existingSentences.size) return incoming

  const spans = sentenceSpans(incoming)
  const isRepeat = (span: string): boolean =>
    isSubstantialSentence(span) &&
    existingSentences.has(normalizedSentence(span))
  if (!spans.some(isRepeat)) return incoming

  const kept = spans.filter(span => !isRepeat(span)).join('')
  return kept.trim() ? kept.replace(/^\s+/, '') : undefined
}
