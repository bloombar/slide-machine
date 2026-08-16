/**
 * The typeface a .pptx should ask for (EXP-1/EXP-6).
 *
 * A template names a font *stack* — `sans`, `serif`, `humanist`, `geometric`,
 * `mono` — because the app never fetches a font at display time
 * (docs/TEMPLATES.md §5): it picks something already on the reader's machine.
 * A .pptx cannot express a stack. PowerPoint takes one font name and, failing
 * that, substitutes silently.
 *
 * Setting nothing is what the exporters did before, and PowerPoint's silent
 * answer is Calibri — so a serif design exported as a sans one, and every
 * template came back "close, but not the typeface I chose". Naming a font
 * from the same family is not the same as embedding the design's own, but it
 * is the difference between recognisable and wrong.
 *
 * The names are the ones bundled with Office on both Windows and macOS, so
 * they resolve without a download on the machines that open these files.
 */
const FACES: Record<string, string> = {
  // Neutral grotesque. Arial over Helvetica: Windows has it, macOS maps it.
  sans: 'Arial',
  serif: 'Georgia',
  // Humanist sans — softer, more calligraphic than a grotesque.
  humanist: 'Verdana',
  // Geometric sans — circular bowls, single-storey a.
  geometric: 'Century Gothic',
  mono: 'Courier New',
}

/**
 * A PowerPoint font name for a template's font stack.
 *
 * Undefined when the design names no font, so the exporter leaves the run
 * alone rather than imposing Arial on a template that never asked for one.
 */
export const pptxFontFace = (stack?: string): string | undefined =>
  stack ? (FACES[stack] ?? FACES.sans) : undefined
