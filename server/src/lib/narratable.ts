/**
 * What of a slide may be read aloud (EDIT-7 / PLAY-2).
 *
 * A slide's boxes are whatever its template declared, so narration cannot ask
 * for "the body" and be done. It has to ask each box what it holds — and some
 * boxes hold things that are not language.
 *
 * **Specialized content is read aloud sensibly or not at all.** A formula's
 * LaTeX read out is a stream of backslashes and braces; a program listing is
 * punctuation with a few words in it. Neither is what a listener wants, and
 * neither is what the lecturer would have said. So `code`, `math` and `table`
 * contribute nothing here. What they mean belongs in the narration the
 * lecturer writes or the model composes from the surrounding prose, not in a
 * transcription of their source.
 *
 * `preformatted` does contribute: its spacing carries meaning on screen, but
 * its words are still words.
 *
 * Written as an exhaustive switch so a kind added to `SlotValue` fails to
 * compile here until somebody decides which side of the line it falls on. A
 * new kind cannot quietly default into being read out.
 */
import type { SlotValue } from '@slide-machine/shared'

/** What one box contributes to what is said, if anything. */
const spokenValue = (value: SlotValue): string[] => {
  switch (value.kind) {
    case 'text':
    case 'preformatted':
      return value.value.trim() ? [value.value.trim()] : []
    case 'bullets':
      return value.items.filter(item => item.trim())
    case 'image':
    case 'code':
    case 'math':
    case 'table':
      return []
    default: {
      // A kind nobody has classified is not read aloud — the safe default,
      // and one that shows up as silence rather than as noise.
      const exhaustive: never = value
      void exhaustive
      return []
    }
  }
}

/**
 * The prose a slide's boxes hold, beyond the conventional fields the narration
 * request already carries.
 *
 * The conventional four are excluded because they are sent as themselves; what
 * is left is everything a template's author named, which would otherwise be
 * invisible to narration however much of the slide it is.
 */
const CONVENTIONAL = new Set(['title', 'body', 'bullets', 'caption'])

export const narratableText = (
  slots: Record<string, SlotValue> | undefined,
): string[] => {
  if (!slots) return []
  const out: string[] = []
  for (const [name, value] of Object.entries(slots)) {
    if (CONVENTIONAL.has(name)) continue
    out.push(...spokenValue(value))
  }
  return out
}
