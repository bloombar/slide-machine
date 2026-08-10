/**
 * Every formula a deck contains, typeset before any of it is drawn (EXP-7).
 *
 * Both exporters need the same thing and neither can wait mid-draw: the pptx
 * builder places shapes synchronously, and the PDF one writes a page at a
 * time. So the formulas are gathered up front, exactly as the images already
 * are, and handed to the renderer as a finished lookup.
 *
 * Distinct texs, not distinct boxes: the same formula restated on a summary
 * slide is typeset once.
 */
import type { ExportNote } from '@slide-machine/shared'
import type { LayoutBox } from './deck-layout'
import { typesetFormula, type TypesetFormula } from './math-render'

/** Typeset formulas, by their source. */
export type Formulas = Map<string, TypesetFormula>

/**
 * Typesets the formulas among these boxes.
 *
 * A formula that will not typeset is left out and named in `notes`, which
 * becomes the export's report. The alternative — writing the LaTeX onto the
 * slide — is the thing EXP-7 exists to prevent, and silence would be worse
 * still: a slide with a hole where an equation was, and nothing said.
 */
export const typesetFormulas = async (
  boxes: LayoutBox[],
  color: string,
  notes?: ExportNote[],
): Promise<Formulas> => {
  const wanted = new Set(
    boxes.filter(box => box.kind === 'math').map(box => box.tex),
  )
  const formulas: Formulas = new Map()
  for (const tex of wanted) {
    const drawn = await typesetFormula(tex, color)
    if (drawn) formulas.set(tex, drawn)
    else notes?.push({ reason: 'math-not-typeset', detail: tex })
  }
  return formulas
}
