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
 * Word-based rather than time-based by design: a count of stable words is
 * deterministic and speaker-rate-agnostic, and needs no timers.
 */

export interface InterimFlushResult {
  /** The still-unsubmitted tail of the finalized utterance ('' when every
   * word was already flushed mid-speech). */
  text: string
  /** How many words had been flushed mid-speech before this final. */
  flushed: number
}

export interface InterimFlusher {
  /** Feeds one interim update. Returns a phrase to submit when the stable
   * prefix has outgrown the word threshold, else null. */
  interim(text: string): string | null
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

  const reset = (): void => {
    prevWords = []
    flushedCount = 0
  }

  return {
    interim(text) {
      const words = wordsOf(text)
      const stable = commonPrefixLength(prevWords, words)
      prevWords = words
      if (stable - flushedCount < wordThreshold) return null
      const flush = words.slice(flushedCount, stable).join(' ')
      flushedCount = stable
      return flush
    },
    final(text) {
      const flushed = flushedCount
      // Slice by word count rather than matching text: the recognizer may
      // still have revised an already-flushed word, and a slightly off
      // boundary beats resubmitting a minute of speech.
      const remainder = wordsOf(text).slice(flushed).join(' ')
      reset()
      return { text: remainder, flushed }
    },
    reset,
  }
}
