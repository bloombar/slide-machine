/**
 * The prompt that names imported layouts (TMPL-8 pass 5).
 *
 * Lives beside the provider rather than in `src/import` because the importer
 * reaches its model through the registry — a prompt in the import module would
 * put a cycle between the two.
 *
 * ## Why a preferred vocabulary
 *
 * Layout types are open strings, and pass 5 merges layouts that share one. A
 * model free to invent a name per layout would merge nothing, silently
 * defeating the pass that exists to stop a 40-slide deck yielding 25 layouts.
 * So the conventional names are offered as a preference, with a novel name
 * allowed only when none fits.
 */
import type { ImportedLayoutDescriptor } from '@slide-machine/shared'

/**
 * The conventional layout types (SPEC TMPL-2) — the same names every built-in
 * template uses, which is the point: shared names are what let layouts be
 * compared, merged during import, and selected by the AI. An imported design
 * that called its bullet slide something novel would sit outside all of that.
 *
 * A preference, not a constraint — a deck really can contain a design none of
 * these describes, and forcing one on it would be a worse lie than a novel
 * name (TMPL-9).
 */
export const LAYOUT_VOCABULARY = [
  'title',
  'section',
  'content',
  'list',
  'image-heavy',
  'two-column',
  'quote',
] as const

/** One layout, in as few words as carry the design. Positions are percentages
 * of the slide from its top-left, which is enough for a reader to picture it
 * without seeing it. */
const describeLayout = (
  layout: ImportedLayoutDescriptor,
  index: number,
): string => {
  const slots = layout.slots
    .map(slot => {
      const { x, y, w, h } = slot.box
      const at = `${Math.round(x * 100)},${Math.round(y * 100)} ${Math.round(
        w * 100,
      )}x${Math.round(h * 100)}`
      const size = slot.fontSize ? `, ${slot.fontSize.toFixed(1)}cqi` : ''
      const weight = slot.bold ? ', bold' : ''
      return `    - ${slot.name} (${slot.kind}) at ${at}${size}${weight}`
    })
    .join('\n')
  return `  Layout ${index + 1} — used by ${layout.slideCount} slide(s)\n${slots}`
}

/** Asks for names and sentences only — never geometry, so a wrong answer
 * mislabels a layout but can never produce one that draws incorrectly. */
export const importSemanticsPrompt = (
  layouts: ImportedLayoutDescriptor[],
): string =>
  [
    'You are naming the slide layouts derived from a presentation.',
    '',
    'Each layout below lists its boxes: a name, what kind of content it holds,',
    'its position and size as percentages of the slide from the top-left, and',
    'its type size where known.',
    '',
    layouts.map(describeLayout).join('\n\n'),
    '',
    'For each layout return:',
    '  - "type": what kind of slide this is. STRONGLY PREFER one of these',
    `    names: ${LAYOUT_VOCABULARY.join(', ')}.`,
    '    Reuse the same name for layouts that are the same kind of slide, even',
    '    when their boxes sit in different places — that is how near-duplicate',
    '    layouts get combined. Invent a name only when none of the above fits.',
    '  - "description": one short sentence an instructor would recognize the',
    '    layout by. No jargon.',
    '  - "slots": a sentence per box saying what belongs in it, keyed by the',
    '    box name exactly as given above.',
    '',
    'Judge a box by its position, size and kind — a large box at the top is a',
    'title whatever it is called.',
    '',
    'Return JSON: {"layouts":[{"type":"...","description":"...",',
    '"slots":{"<box name>":"..."}}]} with one entry per layout, in order.',
  ].join('\n')
