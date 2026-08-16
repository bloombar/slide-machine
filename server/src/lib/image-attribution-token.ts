/**
 * An image's provenance, carried through Google Slides and PowerPoint
 * (IMG-5 / EXP-8).
 *
 * Neither format has a field for where a picture came from. The YAML export
 * carries the whole TASL block and restores it exactly, but a deck exported
 * to Slides, worked on there, and imported back lost its credits — the
 * pictures returned anonymous, and a licence that requires attribution was
 * silently no longer satisfied.
 *
 * EXP-8 already solves this shape of problem for slot metadata: alt text is a
 * field both formats keep, both round-trip, and no reader repurposes. This
 * writes a second line into the same place, beside the `slot:` token that
 * already lives there.
 *
 *     slot:image
 *     credit:{"title":"Mitochondrion","creator":"Ada", ...}
 *
 * ## The alt text is still the user's
 *
 * Read and written a line at a time, exactly as the slot token is. Someone
 * may have typed a real description for a screen reader, and that is worth
 * more than our marker — so a line we do not recognise is left alone, and
 * ours is removed rather than the whole field being replaced.
 */
import type { ImageAttribution } from '@slide-machine/shared'

/** Marks the line as ours. `credit:` rather than `attribution:` because alt
 * text is a small field and a shorter prefix leaves more of it for the
 * description that belongs to the user. */
export const CREDIT_TOKEN_PREFIX = 'credit:'

/**
 * A ceiling, because alt text is not storage.
 *
 * A TASL block is a few hundred bytes; anything approaching this is not one,
 * and writing it would push a genuine description out of a field that has to
 * hold both. Over the limit the credit is dropped rather than truncated —
 * half a licence is worse than none, since it reads as complete.
 */
export const MAX_CREDIT_PAYLOAD = 1200

/**
 * Marks a text box as a printed credit rather than something the author wrote.
 *
 * A visual export prints the credit under its picture, because a licence has
 * to be readable in the file itself. Re-imported, that line was read as
 * content: the credit appeared as a caption ON the slide, in a box nobody
 * made, while the picture's own provenance dialog stayed empty — the right
 * words in the wrong place.
 *
 * The provenance already travels on the picture's alt text, so the printed
 * line carries nothing the import needs. Marked, it can be left where it
 * belongs: on the page, not in the lecture.
 */
export const CREDIT_LINE_TOKEN = 'credit-line'

/** Whether a shape's alt text says it is a credit this system printed. */
export const isCreditLine = (altText: string | undefined): boolean =>
  (altText ?? '').split(/\r?\n/).some(line => line.trim() === CREDIT_LINE_TOKEN)

/** The alt-text line carrying an image's provenance, or nothing when there is
 * none worth carrying. */
export const creditToken = (
  attribution: ImageAttribution | undefined,
): string | undefined => {
  if (!attribution) return undefined
  const kept = Object.fromEntries(
    Object.entries(attribution).filter(
      ([, v]) => typeof v === 'string' && v.trim(),
    ),
  )
  if (!Object.keys(kept).length) return undefined
  const line = `${CREDIT_TOKEN_PREFIX}${JSON.stringify(kept)}`
  return Buffer.byteLength(line, 'utf8') > MAX_CREDIT_PAYLOAD ? undefined : line
}

/**
 * The provenance an image's alt text carries, or nothing.
 *
 * Never throws: alt text is a field a human can edit, so a line that starts
 * like ours but is not valid JSON is treated as a line that is not ours
 * rather than as a broken import.
 */
export const creditFromToken = (
  altText: string | undefined,
): ImageAttribution | undefined => {
  if (!altText) return undefined
  for (const line of altText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(CREDIT_TOKEN_PREFIX)) continue
    const payload = trimmed.slice(CREDIT_TOKEN_PREFIX.length).trim()
    if (Buffer.byteLength(payload, 'utf8') > MAX_CREDIT_PAYLOAD) continue
    try {
      const parsed: unknown = JSON.parse(payload)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue
      }
      // Strings only, and only the fields TASL defines: alt text is editable,
      // so what comes back is treated as input rather than as our own data.
      const out: Record<string, string> = {}
      for (const key of [
        'caption',
        'title',
        'creator',
        'creatorUrl',
        'sourceUrl',
        'sourceName',
        'license',
        'licenseUrl',
      ] as const) {
        const value = (parsed as Record<string, unknown>)[key]
        if (typeof value === 'string' && value.trim()) out[key] = value
      }
      if (Object.keys(out).length) return out as ImageAttribution
    } catch {
      // Not ours after all.
    }
  }
  return undefined
}
