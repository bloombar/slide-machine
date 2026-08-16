/**
 * The one-line credit an exported image carries (IMG-5 / EXP-1).
 *
 * A picture the app sourced comes with its TASL provenance — Title, Author,
 * Source, Licence — and that travels with the file. It is why the YAML export
 * carries the whole attribution block: a downstream copy has to stay
 * licence-compliant.
 *
 * A visual export cannot carry a block, so it carries a line. The PDF once
 * printed one and lost it in the layout-aware rendering refactor (ef5e395);
 * the PowerPoint and Google Slides exports never had one. Shared here so the
 * three cannot drift again, and so a fourth format gets it by asking.
 *
 * The order is the one a reader expects and a licence requires:
 *
 *     "Mitochondrion" by Ada Lovelace via Wikimedia — CC BY-SA 4.0
 *
 * Absent fields drop out rather than leaving punctuation behind, and a slide
 * with nothing worth printing gets no line at all — an empty credit under a
 * picture reads as a mistake.
 */
import type { ImageAttribution } from '@slide-machine/shared'

export const imageCredit = (
  attribution: ImageAttribution | undefined,
): string | undefined => {
  if (!attribution) return undefined
  const parts: string[] = []
  if (attribution.title) parts.push(`"${attribution.title}"`)
  if (attribution.creator) parts.push(`by ${attribution.creator}`)
  if (attribution.sourceName) parts.push(`via ${attribution.sourceName}`)
  if (attribution.license) parts.push(`— ${attribution.license}`)
  const credit = parts.join(' ').trim()
  return credit || undefined
}
