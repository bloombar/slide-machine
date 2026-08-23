/**
 * Adding, editing and reordering slides (docs/MCP.md §4.1).
 *
 * `edit_slides` is batched on purpose, and it is the clearest illustration of
 * why tools are not actions. Rewriting six slides is six `slide.editContent`
 * calls, which through the app is six clicks and through an agent is six full
 * model round-trips — six turns of latency, six repetitions of the whole tool
 * list in context. Batching is not a convenience here; it is the difference
 * between a usable tool and one an assistant gives up on.
 *
 * It is still a facade: each edit in the batch is a separate dispatch through
 * the same action, authorized and metered individually.
 */
import { z } from 'zod'
import type { Deck, Slide } from '@slide-machine/shared'
import { defineTool } from '../tool'
import { registerTool } from '../registry'

/** One slide's edit — every field optional, since a caller may change one. */
const slideEdit = z.object({
  slideId: z.string().min(1).describe('The slide id, from read_lecture.'),
  title: z.string().optional().describe('Replaces the slide’s title.'),
  body: z.string().optional().describe('Replaces the slide’s body text.'),
  bullets: z
    .array(z.string())
    .optional()
    .describe('Replaces the slide’s bullet list in full.'),
  caption: z.string().optional().describe('Replaces the image caption.'),
  layoutType: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Switches the slide to another layout of the lecture’s template. Must be one of the layout names read_lecture reported; anything else is refused.',
    ),
})

export const editSlides = defineTool({
  name: 'edit_slides',
  title: 'Edit slides',
  description:
    'Changes the content, and optionally the layout, of one or more slides in ' +
    'one call. Prefer one call with several edits over several calls. Each ' +
    'field you pass REPLACES what was there; fields you omit are left alone. ' +
    'Slide ids come from read_lecture.',
  readOnly: false,
  uses: ['slide.editContent', 'slide.setLayout'],
  input: {
    edits: z
      .array(slideEdit)
      .min(1)
      .max(50)
      .describe('The edits to apply, in order.'),
  },
  run: async (call, input) => {
    const done: string[] = []
    for (const edit of input.edits) {
      const { slideId, layoutType, ...content } = edit
      // Layout first: switching layout remaps the slide's slots, so applying
      // content afterwards writes into the boxes the new layout actually has.
      if (layoutType) {
        await call<Slide>('slide.setLayout', { slideId, layoutType })
      }
      if (Object.keys(content).length > 0) {
        await call<Slide>('slide.editContent', { slideId, ...content })
      }
      done.push(slideId)
    }
    return {
      text: `Edited ${done.length} slide${done.length === 1 ? '' : 's'}: ${done.join(', ')}.`,
      data: { edited: done },
    }
  },
})

export const addSlide = defineTool({
  name: 'add_slide',
  title: 'Add a slide',
  description:
    'Appends a new slide to the end of a lecture and fills in its content. ' +
    'Use reorder_slides afterwards if it belongs somewhere other than last.',
  readOnly: false,
  uses: ['slide.add', 'slide.editContent'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    layoutType: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A layout name from the lecture’s template. Omit for the default content layout.',
      ),
    title: z.string().optional().describe('The slide’s title.'),
    body: z.string().optional().describe('The slide’s body text.'),
    bullets: z.array(z.string()).optional().describe('The slide’s bullets.'),
  },
  run: async (call, input) => {
    const { lectureId, layoutType, ...content } = input
    const slide = await call<Slide>('slide.add', {
      deckId: lectureId,
      ...(layoutType ? { layoutType } : {}),
    })
    // A new slide starts empty, so the content edit is a second call rather
    // than part of the first — which is exactly the round trip this tool
    // exists to save the model.
    const filled = Object.keys(content).length
      ? await call<Slide>('slide.editContent', {
          slideId: slide.id,
          ...content,
        })
      : slide
    return {
      text: `Added slide ${filled.id} to lecture ${lectureId} as slide ${filled.index + 1}, using the "${filled.layoutType}" layout.`,
      data: {
        id: filled.id,
        index: filled.index,
        layoutType: filled.layoutType,
      },
    }
  },
})

export const reorderSlides = defineTool({
  name: 'reorder_slides',
  title: 'Reorder slides',
  description:
    'Sets the order of a lecture’s slides. Pass EVERY slide id of the lecture, ' +
    'in the order you want them; a partial list is refused. Read the lecture ' +
    'first to get the full set.',
  readOnly: false,
  uses: ['deck.reorderSlides'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    slideIds: z
      .array(z.string().min(1))
      .min(1)
      .describe('Every slide id of the lecture, in the new order.'),
  },
  run: async (call, input) => {
    const deck = await call<Deck>('deck.reorderSlides', {
      deckId: input.lectureId,
      slideOrder: input.slideIds,
    })
    return {
      text: `Reordered the ${deck.slideOrder.length} slides of lecture ${deck.id}.`,
      data: { id: deck.id, slideOrder: deck.slideOrder },
    }
  },
})

registerTool(editSlides)
registerTool(addSlide)
registerTool(reorderSlides)
