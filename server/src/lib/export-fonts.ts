/**
 * The typeface an export sets a box in (TMPL-8 / EXP-1).
 *
 * A template names one of the app's font stacks — `serif`, `condensed` and so
 * on (`client/src/components/slide/fonts.ts`) — which is a CSS stack, and a
 * stack means nothing to a PDF or a .pptx. Each format is told the nearest
 * face it can actually set, so a deck designed in a serif comes out of the
 * exporter in a serif rather than in the one font the exporter happened to
 * embed.
 *
 * Approximate on purpose, and for the same reason the mapping exists at all:
 * a font is never fetched from a third party, so what an export can offer is
 * the face most likely to be on the machine that opens it.
 */

/**
 * A face name for PowerPoint and Google Slides.
 *
 * Named rather than stacked, because pptx has one font per run. Chosen from
 * the faces both PowerPoint and Slides ship with, so the file opens as
 * intended rather than falling back to whatever the reader's default is.
 */
const PPTX_FACES: Record<string, string> = {
  sans: 'Arial',
  serif: 'Georgia',
  humanist: 'Trebuchet MS',
  geometric: 'Century Gothic',
  condensed: 'Arial Narrow',
  handwritten: 'Comic Sans MS',
  mono: 'Courier New',
}

/** The face a .pptx should set, or nothing when the box asked for no stack in
 * particular and the file's default is as good an answer. */
export const pptxFace = (family: string | undefined): string | undefined =>
  family ? PPTX_FACES[family] : undefined

/**
 * Which of a PDF's three standard families a stack belongs to.
 *
 * A PDF carries only the fonts it embeds, and embedding one per stack would
 * put five faces in every file for a difference few would notice. The three
 * standard families — Helvetica, Times, Courier — are in every reader by
 * definition, and they carry the distinction that actually reads at a
 * distance: whether the type has serifs, and whether it is fixed-width.
 */
export const pdfFamily = (
  family: string | undefined,
): 'sans' | 'serif' | 'mono' => {
  if (family === 'mono') return 'mono'
  if (family === 'serif') return 'serif'
  return 'sans'
}
