/**
 * Splits narration text into phrases (roughly sentences) with their character
 * spans, shared by the TTS mark inserter (where to place `<mark>` timepoints)
 * and the refine remap (candidate phrases to re-match a stroke against). Kept
 * deliberately simple — sentence-terminator based, whitespace-trimmed — since
 * both callers only need stable, monotonic spans over the same input.
 */

/** A phrase and its half-open character span [start, end) in the source text. */
export interface Phrase {
  text: string
  start: number
  end: number
}

/**
 * Segments `text` into phrases at sentence terminators (`. ! ?`), keeping the
 * terminator with its phrase and skipping empty runs. `start`/`end` index the
 * ORIGINAL string, so a phrase's `charOffset` and length are exact. Text with
 * no terminator yields a single phrase spanning the whole string.
 */
export const segmentPhrases = (text: string): Phrase[] => {
  const phrases: Phrase[] = []
  // Match runs ending at a sentence terminator (with trailing quotes/brackets)
  // or at end of string; capture leading whitespace to advance the cursor.
  const re = /[^.!?]*[.!?]+["')\]]*|[^.!?]+$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (!trimmed) continue
    const start = m.index + lead
    phrases.push({ text: trimmed, start, end: start + trimmed.length })
  }
  return phrases
}
