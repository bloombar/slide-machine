/**
 * Semantic re-anchoring of whiteboard marks when a slide's transcript is
 * rewritten by refinement (WB-2). Each mark carries a snapshot of the phrase it
 * was drawn over (`phraseText`) plus a 0..1 position within it (`phraseOffset`);
 * this embeds that fingerprint and every phrase of the NEW transcript and
 * re-binds `charAnchor` to the conceptually-closest phrase, so a mark tracks its
 * idea across rewording rather than a proportional point.
 *
 * Policies (see docs/DECISIONS.md):
 *  - below-threshold best match ⇒ the phrase is gone ⇒ mark `orphaned` (hidden).
 *  - no fingerprint (legacy / mic-off marks), or embeddings unavailable ⇒
 *    proportional `remapAnchor` fallback (never orphans).
 *  - fingerprints are matched against the ORIGINAL captured phrase, so repeated
 *    refines don't accumulate drift.
 *
 * Kept pure and injectable (`embed` passed in) so it unit-tests without a DB.
 */
import {
  cosineSimilarity,
  remapAnchor,
  segmentPhrases,
  type Stroke,
  type StrokeAnchor,
} from '@slide-machine/shared'

/** Minimum cosine similarity for a stored phrase to re-bind to a new phrase;
 * below this the phrase is considered gone. Tuned to the embedding model
 * (GEMINI_EMBED_MODEL): gemini-embedding-001 scores rewordings of the same
 * phrase ≥0.81 and unrelated lecture phrases ≤0.68 (measured Aug 2026), so
 * 0.75 splits the gap. Re-measure before changing the embedding model —
 * the old text-embedding-004 value was 0.5. */
export const PHRASE_MATCH_THRESHOLD = 0.75

export const remapDrawingAnchors = async (
  strokes: Stroke[],
  oldTranscript: string,
  newTranscript: string,
  embed: (texts: string[]) => Promise<number[][]>,
  threshold = PHRASE_MATCH_THRESHOLD,
): Promise<Stroke[]> => {
  const oldLen = oldTranscript.length
  const newLen = newTranscript.length
  const phrases = segmentPhrases(newTranscript)

  const fingerprints = [
    ...new Set(
      strokes
        .flatMap(s => [s.anchor, s.erasedAnchor])
        .map(a => a?.phraseText)
        .filter((t): t is string => Boolean(t)),
    ),
  ]

  // fingerprint → best new phrase span, or null when below threshold (orphan).
  // Left null overall when there is nothing to embed or embeddings fail, so
  // every anchor takes the proportional fallback.
  let matchByFingerprint: Map<
    string,
    { start: number; end: number } | null
  > | null = null
  if (fingerprints.length && phrases.length) {
    try {
      const vectors = await embed([
        ...fingerprints,
        ...phrases.map(p => p.text),
      ])
      const fpVecs = vectors.slice(0, fingerprints.length)
      const phraseVecs = vectors.slice(fingerprints.length)
      matchByFingerprint = new Map()
      fingerprints.forEach((fp, i) => {
        let best = -Infinity
        let bestIdx = -1
        phraseVecs.forEach((pv, j) => {
          const sim = cosineSimilarity(fpVecs[i]!, pv)
          if (sim > best) {
            best = sim
            bestIdx = j
          }
        })
        const phrase = phrases[bestIdx]
        matchByFingerprint!.set(
          fp,
          bestIdx >= 0 && phrase && best >= threshold
            ? { start: phrase.start, end: phrase.end }
            : null,
        )
      })
    } catch (error) {
      console.warn('Stroke phrase remap fell back to proportional:', error)
      matchByFingerprint = null
    }
  }

  const remapOne = (a: StrokeAnchor): StrokeAnchor => {
    if (a.phraseText && matchByFingerprint) {
      const match = matchByFingerprint.get(a.phraseText)
      if (match === null) return { ...a, orphaned: true }
      if (match) {
        const phraseLen = match.end - match.start
        const offset = a.phraseOffset ?? 0
        return {
          ...a,
          charAnchor: match.start + Math.round(offset * phraseLen),
          orphaned: false,
        }
      }
    }
    // Proportional fallback (legacy marks / embeddings unavailable).
    return { ...a, charAnchor: remapAnchor(a.charAnchor, oldLen, newLen) }
  }

  return strokes.map(s => ({
    ...s,
    anchor: remapOne(s.anchor),
    ...(s.erasedAnchor ? { erasedAnchor: remapOne(s.erasedAnchor) } : {}),
  }))
}
