/**
 * Mid-speech interim flush (GEN-12). Speech recognizers only finalize a
 * phrase after a trailing pause, so during long uninterrupted speech no
 * finalized phrase — and therefore no slide — appears for as long as the
 * speaker keeps going. This tracker watches the volatile interim transcript
 * and, once its *stable* prefix (words unchanged across consecutive interim
 * updates) grows past a word threshold, hands that prefix over to be
 * submitted as a phrase mid-speech. When the recognizer eventually
 * finalizes the utterance, only the words not already flushed remain to be
 * submitted, so nothing reaches generation twice.
 *
 * A flushed prefix is still just the recognizer's hypothesis at that moment,
 * and it can revise those words before the utterance finalizes — `final()`
 * also returns, per flush, the finalized wording for the same word range, so
 * the caller can correct whatever slide the flush landed on (the interim-flush
 * reconciliation in DeckViewerPage).
 *
 * Word-based rather than time-based by design: a count of stable words is
 * deterministic and speaker-rate-agnostic, and needs no timers.
 */

/** One mid-speech flush, returned from `interim()` for the caller to submit. */
export interface InterimFlush {
  /** The phrase to submit. */
  text: string
  /** Identifies this flush within the utterance (submission order), so its
   * eventual finalized wording can be matched back to it once the utterance
   * completes — see InterimFlushResult.corrections. */
  seq: number
}

/** Pairs one mid-speech flush with the finalized wording for the same word
 * range, so the slide it produced can be reconciled (GEN-12) — the recognizer
 * may have revised those words by the time the utterance finalizes, and
 * `submitted` is what actually reached generation. */
export interface InterimFlushCorrection {
  seq: number
  submitted: string
  final: string
}

export interface InterimFlushResult {
  /** The still-unsubmitted tail of the finalized utterance ('' when every
   * word was already flushed mid-speech). */
  text: string
  /** How many words had been flushed mid-speech before this final. */
  flushed: number
  /** One entry per mid-utterance flush, in submission order. Includes entries
   * where `final === submitted` (nothing to correct) — callers should skip
   * those rather than write a no-op. Empty when nothing was flushed. */
  corrections: InterimFlushCorrection[]
}

export interface InterimFlusher {
  /** Feeds one interim update. Returns a phrase to submit when the stable
   * prefix has outgrown the word threshold, else null. */
  interim(text: string): InterimFlush | null
  /** Feeds the finalized utterance, returning what is left to submit, and
   * resets for the next utterance. */
  final(text: string): InterimFlushResult
  /** Drops per-utterance state (capture restart). */
  reset(): void
}

/** Splits into words the same way flush boundaries are counted. */
const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/** Words shared, in order, from the start of both lists. */
const commonPrefixLength = (a: string[], b: string[]): number => {
  const max = Math.min(a.length, b.length)
  let n = 0
  while (n < max && a[n] === b[n]) n++
  return n
}

export const createInterimFlusher = (wordThreshold: number): InterimFlusher => {
  // Words of the previous interim update; a word is "stable" once two
  // consecutive updates agree on it, since recognizers freely revise the
  // tail of their hypothesis but rarely re-open settled text.
  let prevWords: string[] = []
  // How many words of the current utterance have already been submitted.
  let flushedCount = 0
  // Next flush's seq number, and the word range + text submitted for every
  // flush so far — final() replays each range against the finalized word
  // list to recover what the recognizer settled on (GEN-12 reconciliation).
  let nextSeq = 0
  let flushes: { seq: number; start: number; end: number; text: string }[] = []

  const reset = (): void => {
    prevWords = []
    flushedCount = 0
    nextSeq = 0
    flushes = []
  }

  return {
    interim(text) {
      const words = wordsOf(text)
      const stable = commonPrefixLength(prevWords, words)
      prevWords = words
      if (stable - flushedCount < wordThreshold) return null
      const start = flushedCount
      const flush = words.slice(start, stable).join(' ')
      flushedCount = stable
      const seq = nextSeq++
      flushes.push({ seq, start, end: stable, text: flush })
      return { text: flush, seq }
    },
    final(text) {
      const flushed = flushedCount
      const words = wordsOf(text)
      // Slice by word count rather than matching text: the recognizer may
      // still have revised an already-flushed word, and a slightly off
      // boundary beats resubmitting a minute of speech.
      const remainder = words.slice(flushed).join(' ')
      // Same word-count slicing recovers the finalized wording for each
      // earlier flush, so its slide can be reconciled with what the
      // recognizer settled on rather than the pre-revision hypothesis it
      // was submitted with.
      const corrections = flushes.map(f => ({
        seq: f.seq,
        submitted: f.text,
        final: words.slice(f.start, f.end).join(' '),
      }))
      reset()
      return { text: remainder, flushed, corrections }
    },
    reset,
  }
}
