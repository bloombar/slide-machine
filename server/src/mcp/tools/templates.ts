/**
 * Looking at and switching designs (docs/MCP.md §4.1).
 *
 * `restyle_lecture` is the "switch all fourteen lectures to the new department
 * template" case — an afternoon of clicking, or one instruction. It is
 * deliberately one lecture per call rather than taking a list: an agent
 * changing the look of every lecture an instructor owns in a single
 * unconfirmable step is the shape of mistake this surface is built to avoid,
 * and a fourteen-call loop is a cost worth paying for a step the user can see
 * happening.
 */
import { z } from 'zod'
import type { Deck, Template } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { defineTool } from '../tool'
import { registerTool } from '../registry'
import { layoutDescriptors } from '../../templates/builtin'
import { WRITABLE_FIELDS } from './fit-report'

/** A layout's own type list, minus the manual drawing canvas — nothing on
 * this connection may target it (see slides.ts), so it never belongs in
 * what a model is told it can write to. */
const namedLayouts = (template: Pick<Template, 'layouts'>): string[] =>
  template.layouts
    .filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
    .map(l => l.type)

/** Whether add_slide/add_slides/edit_slides can address this box at all —
 * they only ever touch title/body/bullets/caption (fit-report.ts's
 * WRITABLE_FIELDS), so a layout with a `figure` or `snippet` box has boxes
 * this tool surface simply cannot reach, no matter what list_templates says
 * about their kind or budget. */
const isWritable = (slotName: string): boolean =>
  (WRITABLE_FIELDS as readonly string[]).includes(slotName)

/** One box's kind and budget, as a short phrase — the same numbers
 * `layoutDescriptors` hands the app's own generator, so a model is told
 * exactly what fits rather than a summary that could drift from it. Marked
 * "app only" when add_slide/add_slides/edit_slides cannot write it at all,
 * so a model does not spend a call finding that out the hard way. */
const boxLine = (slot: {
  name: string
  kind: string
  maxChars?: number
  maxItems?: number
}): string => {
  const budget = [
    slot.maxItems ? `≤${slot.maxItems} items` : undefined,
    slot.maxChars ? `≤${slot.maxChars} chars` : undefined,
  ]
    .filter(Boolean)
    .join(', ')
  const suffix = isWritable(slot.name) ? '' : ', app only'
  return `${slot.name} (${slot.kind}${budget ? `, ${budget}` : ''}${suffix})`
}

export const listTemplates = defineTool({
  name: 'list_templates',
  title: 'List templates',
  description:
    'Lists the slide designs this account can use — the built-in ones and any ' +
    'it has authored — with the id of each and the layout names it offers. ' +
    'Layout names are what add_slide and edit_slides accept as layoutType. ' +
    'Pass templateId to see, for one template, every layout’s boxes with their ' +
    'kind and budget (maxChars / maxItems) — omit it for the short list above, ' +
    'since a full dump of every layout of every template on every call is a ' +
    'tax on every turn. Text written past a box’s budget is not rejected: it ' +
    'shrinks to a floor and then overflows the slide, so write to these limits.',
  readOnly: true,
  uses: ['template.list'],
  input: {
    templateId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A template id from a prior call, for full layout detail. Omit for the short list of templates and layout names.',
      ),
  },
  run: async (call, input) => {
    const templates = await call<Template[]>('template.list', {})
    if (input.templateId) {
      const template = templates.find(t => t.id === input.templateId)
      if (!template) {
        // template.list is this account's OWN library (its templates plus
        // the built-ins) — but a lecture can legitimately sit on a template
        // outside it (deck.switchTemplate only checks the template exists at
        // all, not that it is in this list). Absence here is not proof the
        // id is wrong, so the id must not be called unknown.
        return {
          isError: true,
          text: `"${input.templateId}" is not among this account’s own templates (list_templates with no templateId lists those). It may still be a real template the account does not own — a lecture on it can be read with read_lecture, whose response includes its layouts and content either way.`,
          data: null,
        }
      }
      const descriptors = layoutDescriptors(template)
      return {
        text: [
          `"${template.name}" (template id: ${template.id}) — ${descriptors.length} layout${descriptors.length === 1 ? '' : 's'}. ` +
            'Text past a box’s budget is not rejected — it shrinks to a floor and then overflows the slide — so write to these limits. ' +
            `Boxes marked "app only" cannot be filled by add_slide, add_slides or edit_slides (they only ever write ${WRITABLE_FIELDS.join(', ')}) — fill those in the app instead.`,
          ...descriptors.map(
            d =>
              `- "${d.label}" (layoutType: "${d.type}") — ${d.purpose}. Boxes: ${d.slots.map(boxLine).join('; ')}`,
          ),
        ].join('\n'),
        data: {
          template: {
            id: template.id,
            name: template.name,
            layouts: descriptors.map(d => ({
              type: d.type,
              label: d.label,
              purpose: d.purpose,
              slots: d.slots.map(s => ({
                name: s.name,
                kind: s.kind,
                maxChars: s.maxChars,
                maxItems: s.maxItems,
                writable: isWritable(s.name),
              })),
            })),
          },
        },
      }
    }
    return {
      text: [
        `${templates.length} template${templates.length === 1 ? '' : 's'} available:`,
        ...templates.map(
          template =>
            `- "${template.name}" (template id: ${template.id}) — layouts: ${namedLayouts(
              template,
            ).join(', ')}`,
        ),
        'Call list_templates again with templateId to see each layout’s boxes and character budgets.',
      ].join('\n'),
      data: {
        templates: templates.map(template => ({
          id: template.id,
          name: template.name,
          layouts: namedLayouts(template),
        })),
      },
    }
  },
})

export const restyleLecture = defineTool({
  name: 'restyle_lecture',
  title: 'Switch a lecture’s design',
  description:
    'Moves one lecture onto a different template. Every slide is remapped to ' +
    'the nearest layout the new design offers, which can change how content is ' +
    'arranged. Template ids come from list_templates. To restyle several ' +
    'lectures, call this once per lecture.',
  readOnly: false,
  uses: ['deck.switchTemplate'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    templateId: z
      .string()
      .min(1)
      .describe('The template to switch to, from list_templates.'),
  },
  run: async (call, input) => {
    const deck = await call<Deck>('deck.switchTemplate', {
      deckId: input.lectureId,
      templateId: input.templateId,
    })
    const count = deck.slideOrder.length
    const remapped =
      count === 0
        ? 'It has no slides to remap.'
        : `Its ${count} slide${count === 1 ? '' : 's'} ${count === 1 ? 'was' : 'were'} remapped to that design’s layouts.`
    return {
      text: `Lecture ${deck.id} now uses template ${deck.templateId}. ${remapped}`,
      data: { id: deck.id, templateId: deck.templateId },
    }
  },
})

registerTool(listTemplates)
registerTool(restyleLecture)
