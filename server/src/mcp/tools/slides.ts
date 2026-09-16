/**
 * Adding, editing and reordering slides (docs/MCP.md §4.1).
 *
 * Batching is a rule of this surface, not an `edit_slides` quirk: rewriting or
 * building six slides one at a time is six action calls, which through the app
 * is six clicks and through an agent is six full model round-trips — six turns
 * of latency, six repetitions of the whole tool list in context. That cost is
 * exactly the same whether the six calls edit existing slides or create new
 * ones, so `add_slides` gets the same treatment as `edit_slides`: batching is
 * not a convenience here; it is the difference between a usable tool and one
 * an assistant gives up on partway through a lecture.
 *
 * It is still a facade: each entry in a batch is a separate dispatch through
 * the same action, authorized individually — and through the metering hook the
 * action layer runs, which for every action this surface reaches is none. That
 * "none" is a property the tool surface is held to, not a coincidence:
 * mcp/forbidden.test.ts fails if any tool composes an action that meters.
 *
 * A batch also has to be honest about a failure partway through. Letting the
 * first error propagate — the original `edit_slides` behaviour — tells the
 * model only that something failed, not which of the earlier entries already
 * landed. For `add_slides` that ambiguity is dangerous: an agent that retries
 * the whole batch on that report duplicates every slide that had already been
 * created. Both batching tools below stop at the first failure and report
 * exactly what succeeded, which entry failed and why, and that the rest were
 * never attempted — see `partialFailureText` below.
 */
import { z } from 'zod'
import type { Deck, Slide } from '@slide-machine/shared'
import { defineTool } from '../tool'
import { registerTool } from '../registry'
import { openAt } from './prose'
import { lectureUrlById } from './links'
import { lectureUrl } from '../../lib/deck-link'
import { describeErrorForAgent } from '../../actions/agent-error'

/**
 * Reports a batch that stopped at `failedIndex`: what the caller already
 * knows happened, why the batch stopped, and which entries were never
 * attempted. `describeErrorForAgent` supplies the "(code: …, retryable: …)"
 * clause for the underlying failure so that convention stays one vocabulary
 * across the server rather than a second one invented here; `notRepeat`
 * carries the reason retrying the succeeded entries would be wrong (or
 * merely wasted), since that reason differs between creating and editing.
 */
const partialFailureText = (
  succeeded: string,
  total: number,
  failedIndex: number,
  err: unknown,
  notRepeat: string,
): string => {
  const described = describeErrorForAgent(err)
  const lastIndex = total - 1
  const single = failedIndex === lastIndex
  const range = single
    ? `entry ${failedIndex}`
    : `entries ${failedIndex} through ${lastIndex}`
  const verb = single ? 'was' : 'were'
  const pronoun = single ? 'that entry' : 'those entries'
  return (
    `${succeeded} Entry at index ${failedIndex} failed: ${described.message} ` +
    `(code: ${described.code}, retryable: ${described.retryable}). ` +
    `The batch stopped there: ${range} ${verb} NOT attempted. Retry only ` +
    `${pronoun}, not the whole batch — ${notRepeat}.`
  )
}

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
  // `deck.get` is here only to turn a slide's lecture id into the address the
  // instructor can open it at (tools/links.ts). It reads nothing this tool
  // reports beyond that link.
  uses: ['slide.editContent', 'slide.setLayout', 'deck.get'],
  input: {
    edits: z
      .array(slideEdit)
      .min(1)
      .max(50)
      .describe('The edits to apply, in order.'),
  },
  run: async (call, input) => {
    const done: string[] = []
    // Which lecture was edited is not an input here — an edit is addressed to
    // slide ids — so it comes back off the slides the actions return.
    let deckId: string | undefined
    for (const [i, edit] of input.edits.entries()) {
      const { slideId, layoutType, ...content } = edit
      try {
        // Layout first: switching layout remaps the slide's slots, so applying
        // content afterwards writes into the boxes the new layout actually has.
        if (layoutType) {
          const slide = await call<Slide>('slide.setLayout', {
            slideId,
            layoutType,
          })
          deckId ??= slide.deckId
        }
        if (Object.keys(content).length > 0) {
          const slide = await call<Slide>('slide.editContent', {
            slideId,
            ...content,
          })
          deckId ??= slide.deckId
        }
        done.push(slideId)
      } catch (err) {
        // Stop rather than compound the failure — see the module docstring.
        // The edits already applied are real writes; the model must be told
        // exactly which they are so it retries only the entries after this
        // one, not the whole batch.
        const succeeded = done.length
          ? `Edited ${done.length} of ${input.edits.length} slide${input.edits.length === 1 ? '' : 's'}: ${done.join(', ')}.`
          : `Edited none of the ${input.edits.length} slides.`
        return {
          isError: true,
          text: partialFailureText(
            succeeded,
            input.edits.length,
            i,
            err,
            'the edits already applied do not need to be repeated',
          ),
          data: { edited: done, failedIndex: i, url: null },
        }
      }
    }
    // Pointed at the first slide edited: a batch touching six slides has no
    // one place to look, and the first is where a reader would start.
    const url = deckId ? await lectureUrlById(call, deckId, done[0]) : undefined
    return {
      text:
        `Edited ${done.length} slide${done.length === 1 ? '' : 's'}: ${done.join(', ')}` +
        `${url ? `. The first of them is at ${url}` : ''}.`,
      data: { edited: done, url: url ?? null },
    }
  },
})

export const addSlide = defineTool({
  name: 'add_slide',
  title: 'Add a slide',
  description:
    'Appends one new slide to the end of a lecture and fills in its content. ' +
    'Use add_slides instead to build several slides in one call — that is ' +
    'the normal way a deck gets built; this tool is for adding a single slide ' +
    'to a lecture that already exists. Use reorder_slides afterwards if it ' +
    'belongs somewhere other than last.',
  readOnly: false,
  // `deck.get` only supplies the lecture's address — see edit_slides.
  uses: ['slide.add', 'slide.editContent', 'deck.get'],
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
    caption: z.string().optional().describe('The image caption.'),
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
    const url = await lectureUrlById(call, lectureId, filled.id)
    return {
      text:
        `Added slide ${filled.id} to lecture ${lectureId} as slide ${filled.index + 1}, ` +
        `using the "${filled.layoutType}" layout${openAt(url)}. If slides you ` +
        'planned are still missing, call add_slide again for the next one — ' +
        'the lecture is not finished until every one of them exists. If that ' +
        'was the last, stop here and offer the instructor the link.',
      data: {
        id: filled.id,
        index: filled.index,
        layoutType: filled.layoutType,
        url: url ?? null,
      },
    }
  },
})

/** One slide to append, as part of an add_slides batch. */
const slideToAdd = z.object({
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
  caption: z.string().optional().describe('The image caption.'),
})

export const addSlides = defineTool({
  name: 'add_slides',
  title: 'Add several slides',
  description:
    'Builds a lecture by appending several new slides in one call, in the ' +
    'order given, each with its own content. This is how a deck gets built — ' +
    'a twelve-slide lecture is one call to this tool, not twelve. Use ' +
    'add_slide instead only to add a single slide to a lecture that already ' +
    'has its content. If a slide part-way through the list fails, the ones ' +
    'before it are already created; the result says exactly which, and only ' +
    'the slides after the failure should be retried.',
  readOnly: false,
  // Exactly add_slide's actions — see the module docstring on why this
  // surface may not reach anything new to batch creation.
  uses: ['slide.add', 'slide.editContent', 'deck.get'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    slides: z
      .array(slideToAdd)
      .min(1)
      .max(50)
      .describe('The slides to append, in order.'),
  },
  run: async (call, input) => {
    const ids: string[] = []
    // The running total, from the index of the last slide actually created —
    // an extra deck.get just to count slides would be a second read for a
    // number the create calls already carry.
    let count = 0
    for (const [i, entry] of input.slides.entries()) {
      const { layoutType, ...content } = entry
      try {
        const slide = await call<Slide>('slide.add', {
          deckId: input.lectureId,
          ...(layoutType ? { layoutType } : {}),
        })
        // A new slide starts empty, so the content edit is a second call —
        // the same round trip add_slide accepts, once per entry here.
        const filled = Object.keys(content).length
          ? await call<Slide>('slide.editContent', {
              slideId: slide.id,
              ...content,
            })
          : slide
        ids.push(filled.id)
        count = filled.index + 1
      } catch (err) {
        // Stop rather than compound the failure — see the module docstring.
        // Retrying the whole batch here would duplicate every slide already
        // created, which is why the text is explicit that only the remaining
        // entries should be retried.
        const succeeded = ids.length
          ? `Added ${ids.length} of ${input.slides.length} slides to lecture ` +
            `${input.lectureId} (now ${count} slide${count === 1 ? '' : 's'}): ${ids.join(', ')}.`
          : `Added none of the ${input.slides.length} slides to lecture ${input.lectureId}.`
        return {
          isError: true,
          text: partialFailureText(
            succeeded,
            input.slides.length,
            i,
            err,
            'the slides already created must not be created again',
          ),
          data: { added: ids, count, failedIndex: i, url: null },
        }
      }
    }
    // One link for the whole batch, to the first slide added — see
    // edit_slides for why a batch does not return one URL per entry.
    const url = ids.length
      ? await lectureUrlById(call, input.lectureId, ids[0])
      : undefined
    return {
      text:
        `Added ${ids.length} slide${ids.length === 1 ? '' : 's'} to lecture ` +
        `${input.lectureId} (now ${count} slide${count === 1 ? '' : 's'}): ` +
        `${ids.join(', ')}${openAt(url)}.`,
      data: { added: ids, count, url: url ?? null },
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
    const url = lectureUrl(deck.permalinkSlug)
    return {
      text: `Reordered the ${deck.slideOrder.length} slides of lecture ${deck.id}${openAt(url)}.`,
      data: { id: deck.id, slideOrder: deck.slideOrder, url: url ?? null },
    }
  },
})

registerTool(editSlides)
registerTool(addSlide)
registerTool(addSlides)
registerTool(reorderSlides)
