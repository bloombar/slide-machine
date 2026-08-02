/**
 * Builds SSML for synthesis with `<mark>` timepoints (WB-2 playback sync). A
 * mark is inserted at each phrase boundary so the synthesizer reports the real
 * spoken time of that character position; the marks are silent, so the audio
 * sounds identical to plain-text synthesis. Each mark name maps back to a
 * character offset in the ORIGINAL plain text, which is what stroke anchors
 * index. Kept pure so it is unit-testable and the provider stays thin.
 */
import { segmentPhrases } from '@slide-machine/shared'

/** Escapes the five XML characters so arbitrary narration is SSML-safe. */
export const escapeSsml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** A mark's name and the plain-text character offset it sits at. */
export interface SsmlMarkRef {
  name: string
  charOffset: number
}

export interface SsmlBuild {
  ssml: string
  marks: SsmlMarkRef[]
  /**
   * Characters Google charges for. SSML is billed including its tags — the
   * `<speak>` wrapper and every entity `escapeSsml` expands — with `<mark>` the
   * one documented exception, so those tags are subtracted back out. Counted
   * here rather than estimated by the caller, because this is the function that
   * decides what the request contains.
   */
  billedCharacters: number
}

/**
 * Wraps `text` in `<speak>` with a `<mark>` at the start of every phrase. Mark
 * names are `mN`; the returned `marks` pair each name with its plain-text
 * offset so the provider can join synthesizer timepoints back to offsets. Text
 * with no phrases (empty/whitespace) yields bare `<speak>` and no marks.
 */
export const buildMarkedSsml = (text: string): SsmlBuild => {
  const phrases = segmentPhrases(text)
  const marks: SsmlMarkRef[] = []
  let ssml = '<speak>'
  let markChars = 0
  phrases.forEach((phrase, i) => {
    const name = `m${i}`
    const tag = `<mark name="${name}"/>`
    markChars += tag.length
    marks.push({ name, charOffset: phrase.start })
    ssml += `${tag}${escapeSsml(phrase.text)} `
  })
  ssml += '</speak>'
  return { ssml, marks, billedCharacters: ssml.length - markChars }
}
