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
import { defineTool } from '../tool'
import { registerTool } from '../registry'

export const listTemplates = defineTool({
  name: 'list_templates',
  title: 'List templates',
  description:
    'Lists the slide designs this account can use — the built-in ones and any ' +
    'it has authored — with the id of each and the layout names it offers. ' +
    'Layout names are what add_slide and edit_slides accept as layoutType.',
  readOnly: true,
  uses: ['template.list'],
  input: {},
  run: async call => {
    const templates = await call<Template[]>('template.list', {})
    return {
      text: [
        `${templates.length} template${templates.length === 1 ? '' : 's'} available:`,
        ...templates.map(
          template =>
            `- "${template.name}" (template id: ${template.id}) — layouts: ${template.layouts
              .map(layout => layout.type)
              .join(', ')}`,
        ),
      ].join('\n'),
      data: {
        templates: templates.map(template => ({
          id: template.id,
          name: template.name,
          layouts: template.layouts.map(layout => layout.type),
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
    return {
      text: `Lecture ${deck.id} now uses template ${deck.templateId}. Its ${deck.slideOrder.length} slides were remapped to that design’s layouts.`,
      data: { id: deck.id, templateId: deck.templateId },
    }
  },
})

registerTool(listTemplates)
registerTool(restyleLecture)
