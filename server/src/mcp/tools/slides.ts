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
import type { Deck, DeckSplitSlideResult, Slide } from '@slide-machine/shared'
import { MAX_SPLIT_PARTS, WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { defineTool } from '../tool'
import type { ActionCaller } from '../tool'
import { registerTool } from '../registry'
import { openAt } from './prose'
import { fetchDeckView } from './links'
import { lectureUrl } from '../../lib/deck-link'
import { describeErrorForAgent } from '../../actions/agent-error'
import { layoutDescriptors } from '../../templates/builtin'
import { fitIssues, fitReportText, type WrittenContent } from './fit-report'

/**
 * `whiteboard` (SPEC.md:345) is a manual drawing canvas: it has no text
 * boxes, so a field written to it is invisible, and the app withholds it
 * from its own generator. The action layer accepts it anyway (slide.add,
 * slide.setLayout do not know this surface should refuse it), so each write
 * tool below refuses it itself before any action runs.
 */
const WHITEBOARD_REFUSAL =
  '"whiteboard" is a manual drawing canvas with no text boxes, so it cannot be filled by this tool.'

/**
 * `available`, when the caller has a lecture id to fetch it with, names the
 * lecture's actual layouts (add_slide, add_slides). `edit_slides` has none —
 * an edit is addressed to a slide id, not a lecture — so it cannot enumerate
 * anything itself; `read_lecture` cannot either, since it only lists the
 * layouts the deck's EXISTING slides already use, not the template's whole
 * catalogue (a deck of nothing but `content` slides would make `content`
 * look like the only option). It is pointed at `list_templates` instead,
 * using the templateId `read_lecture` does report — the one place that can
 * actually answer.
 */
const whiteboardRefusalText = (available?: string[]): string =>
  `${WHITEBOARD_REFUSAL} ${
    available?.length
      ? `Layouts available for this lecture: ${available.join(', ')}.`
      : 'Call read_lecture for this lecture’s templateId, then list_templates ' +
        'with that templateId to see the layouts available.'
  } Choose one of those instead.`

/** One slide's conventional write, for the fit check below. */
interface Written {
  slideId: string
  content: WrittenContent
  layoutType: string
}

/**
 * The deck view for a batch's fit check and link, fetched once no matter how
 * many slides the batch touched — and the issues that check finds. `deckId`
 * absent (nothing landed to read a lecture id off) skips the fetch entirely,
 * matching the rest of this surface's one-read-per-call rule.
 */
const withFit = async (
  call: ActionCaller,
  deckId: string | undefined,
  written: Written[],
) => {
  const view = deckId ? await fetchDeckView(call, deckId) : undefined
  // `undefined` (template unreadable) is distinct from an empty array (read
  // fine, layout just not in it) — fitIssues treats them differently, see
  // its own docstring.
  const descriptors = view?.template
    ? layoutDescriptors(view.template)
    : undefined
  const issues = written.flatMap(w =>
    fitIssues(w.slideId, w.content, w.layoutType, descriptors),
  )
  return { view, issues }
}

/**
 * The MCP-1 anti-hallucination clause (#381): nothing on this surface turns
 * notes, a topic or a title into slides by itself, so a model must not tell
 * the instructor a deck exists until it has actually called one of these two
 * tools enough times. Shared verbatim between `add_slide` and `add_slides` —
 * and pinned by a test on both — because it went missing from `add_slide`
 * once precisely because nothing was testing for it there.
 */
const NO_AUTO_GENERATION =
  'Slides come into existence only through add_slide or add_slides — ' +
  'nothing on this connection turns notes, a topic or a title into slides ' +
  'automatically, and every slide’s content has to be given explicitly.'

/**
 * Reports a batch that stopped at `failedIndex`: what the caller already
 * knows happened, why the batch stopped, and what is still left to do.
 *
 * `describeErrorForAgent` supplies the code/retryable pair for the underlying
 * failure, so that vocabulary stays one across the server rather than a
 * second one invented here — but only its first sentence. The rest of that
 * prose is written for a call that changed nothing at all ("Nothing was
 * changed. Trying once more is reasonable"), which is simply false once an
 * earlier entry in this batch has already landed; splicing it in verbatim is
 * exactly what told a model to retry the whole batch and duplicate work.
 *
 * The untouched range is `failedIndex + 1` onward — the entry that failed was
 * attempted, just unsuccessfully, so it belongs in neither "succeeded" nor
 * "never attempted"; it gets its own clause instead. `entryNote` carries a
 * side effect specific to the failed entry (add_slides' orphaned blank slide,
 * for instance); `notRepeat`, when there is anything already done, says why
 * that part must not be redone.
 */
const partialFailureText = ({
  succeeded,
  total,
  failedIndex,
  err,
  entryNote,
  notRepeat,
}: {
  succeeded: string
  total: number
  failedIndex: number
  err: unknown
  entryNote?: string
  notRepeat?: string
}): string => {
  const described = describeErrorForAgent(err)
  // The first sentence only: describeErrorForAgent's later sentences are
  // written for a call that did nothing ("Nothing was changed", "the operation
  // did not run"), which is false of a batch that already wrote some entries.
  // Matched rather than split so a message that is one sentence keeps its own
  // full stop instead of gaining a second.
  const cause =
    described.message.match(/^.*?\.(?=\s|$)/)?.[0] ?? `${described.message}.`
  const untouched: number[] = []
  for (let j = failedIndex + 1; j < total; j++) untouched.push(j)
  return (
    `${succeeded} Entry ${failedIndex} failed: ${cause} ` +
    `(code: ${described.code}, retryable: ${described.retryable}).` +
    `${entryNote ? ` ${entryNote}` : ''} ` +
    `${
      untouched.length
        ? `Entries never attempted: ${untouched.join(', ')}.`
        : `No entries after entry ${failedIndex} remain.`
    } ` +
    `Retry entry ${failedIndex}${untouched.length ? ` and ${untouched.length === 1 ? 'entry' : 'entries'} ${untouched.join(', ')}` : ''} ` +
    `— not the whole batch.` +
    `${notRepeat ? ` ${notRepeat}` : ''}`
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
  // `deck.get` turns a slide's lecture id into the address the instructor
  // can open it at (tools/links.ts), and supplies the template the fit
  // check below (undrawn boxes, over-budget text) reads real budgets from.
  uses: ['slide.editContent', 'slide.setLayout', 'deck.get'],
  input: {
    edits: z
      .array(slideEdit)
      .min(1)
      .max(50)
      .describe('The edits to apply, in order.'),
  },
  run: async (call, input) => {
    // Refused before any action runs — see WHITEBOARD_REFUSAL. Checked across
    // the whole batch up front, like the input schema itself, rather than
    // partway through: a batch that already wrote some slides and only then
    // discovered a later edit is unfillable would need the partial-failure
    // machinery for a mistake that was visible before anything was sent.
    const whiteboardIndex = input.edits.findIndex(
      e => e.layoutType === WHITEBOARD_LAYOUT_TYPE,
    )
    if (whiteboardIndex !== -1) {
      return {
        isError: true,
        text: `Edit ${whiteboardIndex}: ${whiteboardRefusalText()}`,
        data: { edited: [], url: null },
      }
    }
    const done: string[] = []
    // Which lecture was edited is not an input here — an edit is addressed to
    // slide ids — so it comes back off the slides the actions return.
    let deckId: string | undefined
    // Every edit that wrote conventional content, with the layout it landed
    // on — the fit check below needs both, and neither is this call's input
    // alone: the layout may have just been switched by this same edit.
    const written: Written[] = []
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
          written.push({ slideId, content, layoutType: slide.layoutType })
        }
        done.push(slideId)
      } catch (err) {
        // Stop rather than compound the failure — see the module docstring.
        // The edits already applied are real writes; the model must be told
        // exactly which they are so it retries only what is actually left.
        const succeeded = done.length
          ? `Edited ${done.length} of ${input.edits.length} slide${input.edits.length === 1 ? '' : 's'}: ${done.join(', ')}.`
          : `Edited none of the ${input.edits.length} slides.`
        // The failure prose is byte-identical to before this slice: it comes
        // first and is what #382 pins. What is appended after it is new —
        // the entries that DID land before this one failed may have written
        // something undrawn or over budget, and that is not information a
        // retry of the failed entry ever surfaces again.
        const { issues } = await withFit(call, deckId, written)
        return {
          isError: true,
          text:
            partialFailureText({
              succeeded,
              total: input.edits.length,
              failedIndex: i,
              err,
              // Nothing to warn against redoing when nothing has landed yet.
              notRepeat: done.length
                ? 'The edits already applied do not need to be repeated.'
                : undefined,
            }) + (fitReportText(issues) ?? ''),
          data: {
            edited: done,
            failedIndex: i,
            url: null,
            ...(issues.length ? { fit: issues } : {}),
          },
        }
      }
    }
    // One deck.get for the whole batch — for the link (pointed at the first
    // slide edited: a batch touching six slides has no one place to look) and
    // for the template the fit check reads real budgets from.
    const { view, issues } = await withFit(call, deckId, written)
    const url = view ? lectureUrl(view.deck.permalinkSlug, done[0]) : undefined
    return {
      text:
        `Edited ${done.length} slide${done.length === 1 ? '' : 's'}: ${done.join(', ')}` +
        `${url ? `. The first of them is at ${url}` : ''}.` +
        (fitReportText(issues) ?? ''),
      data: {
        edited: done,
        url: url ?? null,
        ...(issues.length ? { fit: issues } : {}),
      },
    }
  },
})

export const addSlide = defineTool({
  name: 'add_slide',
  title: 'Add a slide',
  description:
    'Appends one new slide to the end of a lecture and fills in its content. ' +
    `${NO_AUTO_GENERATION} ` +
    'Use add_slides instead to build several slides in one call — that is ' +
    'the normal way a deck gets built; this tool is for adding a single slide ' +
    'to a lecture that already exists. Use reorder_slides afterwards if it ' +
    'belongs somewhere other than last.',
  readOnly: false,
  // A fresh slide every call, not a value replaced — see McpTool.idempotent.
  idempotent: false,
  // `deck.get` supplies the lecture's address and the template the fit check
  // below (undrawn boxes, over-budget text) reads real budgets from — see
  // edit_slides.
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
    if (layoutType === WHITEBOARD_LAYOUT_TYPE) {
      const view = await fetchDeckView(call, lectureId)
      const available = view?.template
        ? layoutDescriptors(view.template).map(d => d.type)
        : undefined
      return {
        isError: true,
        text: whiteboardRefusalText(available),
        data: { id: null, url: null },
      }
    }
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
    // One deck.get for the link and for the template the fit check below
    // reads real budgets from — see edit_slides.
    const { view, issues } = await withFit(call, lectureId, [
      { slideId: filled.id, content, layoutType: filled.layoutType },
    ])
    const url = view
      ? lectureUrl(view.deck.permalinkSlug, filled.id)
      : undefined
    return {
      text:
        `Added slide ${filled.id} to lecture ${lectureId} as slide ${filled.index + 1}, ` +
        `using the "${filled.layoutType}" layout${openAt(url)}. If slides you ` +
        'planned are still missing, use add_slides to add the rest in one ' +
        'call rather than calling add_slide again for each one — the ' +
        'lecture is not finished until every one of them exists. If that ' +
        'was the last, stop here and offer the instructor the link.' +
        (fitReportText(issues) ?? ''),
      data: {
        id: filled.id,
        index: filled.index,
        layoutType: filled.layoutType,
        url: url ?? null,
        ...(issues.length ? { fit: issues } : {}),
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
    `a twelve-slide lecture is one call to this tool, not twelve. ${NO_AUTO_GENERATION} ` +
    'Use add_slide instead only to add a single slide to a lecture that ' +
    'already has its content. If a slide part-way through the list fails, ' +
    'the ones before it are already created; the result says exactly which, ' +
    'and only what is still left should be retried.',
  readOnly: false,
  // A fresh slide every call, not a value replaced — see McpTool.idempotent.
  idempotent: false,
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
    // Refused before any slide is created — see WHITEBOARD_REFUSAL and
    // edit_slides' identical up-front check.
    const whiteboardIndex = input.slides.findIndex(
      s => s.layoutType === WHITEBOARD_LAYOUT_TYPE,
    )
    if (whiteboardIndex !== -1) {
      const view = await fetchDeckView(call, input.lectureId)
      const available = view?.template
        ? layoutDescriptors(view.template).map(d => d.type)
        : undefined
      return {
        isError: true,
        text: `Entry ${whiteboardIndex}: ${whiteboardRefusalText(available)}`,
        data: { added: [], count: 0, url: null },
      }
    }
    const ids: string[] = []
    // The running total, from the index of the last slide actually created —
    // an extra deck.get just to count slides would be a second read for a
    // number the create calls already carry.
    let count = 0
    // Every slide actually written, with the layout it landed on — the fit
    // check below needs both, and reads it after the whole batch rather than
    // fetching the template once per entry.
    const written: Written[] = []
    for (const [i, entry] of input.slides.entries()) {
      const { layoutType, ...content } = entry
      // Set once slide.add returns, so the catch block below can tell an
      // orphan (the slide exists; only its content write failed) apart from
      // a failure that created nothing.
      let created: Slide | undefined
      try {
        created = await call<Slide>('slide.add', {
          deckId: input.lectureId,
          ...(layoutType ? { layoutType } : {}),
        })
        // A new slide starts empty, so the content edit is a second call —
        // the same round trip add_slide accepts, once per entry here.
        const filled = Object.keys(content).length
          ? await call<Slide>('slide.editContent', {
              slideId: created.id,
              ...content,
            })
          : created
        ids.push(filled.id)
        count = filled.index + 1
        written.push({
          slideId: filled.id,
          content,
          layoutType: filled.layoutType,
        })
      } catch (err) {
        // A slide.add that succeeded before slide.editContent threw leaves a
        // real, blank slide in the deck — it is not in `ids` or `count` above,
        // but it exists and occupies a slot. Reported here rather than
        // silently dropped: a model that does not know about it either
        // re-adds a duplicate, or leaves a blank slide nobody ever fills.
        const orphan = created
        const currentCount = orphan ? orphan.index + 1 : count
        const succeeded = ids.length
          ? `Added ${ids.length} of ${input.slides.length} slides to lecture ` +
            `${input.lectureId} (now ${currentCount} slide${currentCount === 1 ? '' : 's'}): ${ids.join(', ')}.`
          : `Added none of the ${input.slides.length} slides to lecture ${input.lectureId}${orphan ? ` (now ${currentCount} slide${currentCount === 1 ? '' : 's'})` : ''}.`
        const entryNote = orphan
          ? `Entry ${i} already created slide ${orphan.id} before the content write failed — it exists in the lecture as a blank slide. Do not call add_slides or add_slide for it again; instead call edit_slides on ${orphan.id} to fill it in.`
          : undefined
        // The failure prose is byte-identical to before this slice — see
        // edit_slides for why what is appended after it is not optional: the
        // entries that DID land before this one failed may hold something
        // undrawn or over budget, and a retry of just the failed entry never
        // surfaces that again.
        const { issues } = await withFit(
          call,
          ids.length ? input.lectureId : undefined,
          written,
        )
        return {
          isError: true,
          text:
            partialFailureText({
              succeeded,
              total: input.slides.length,
              failedIndex: i,
              err,
              entryNote,
              // Nothing to warn against redoing when nothing has landed yet.
              notRepeat: ids.length
                ? 'The slides already created must not be created again.'
                : undefined,
            }) + (fitReportText(issues) ?? ''),
          data: {
            added: ids,
            count: currentCount,
            failedIndex: i,
            orphanedId: orphan?.id ?? null,
            url: null,
            ...(issues.length ? { fit: issues } : {}),
          },
        }
      }
    }
    // One deck.get for the whole batch — the link, to the first slide added
    // (see edit_slides for why a batch does not return one URL per entry),
    // and the template the fit check below reads real budgets from.
    const { view, issues } = await withFit(
      call,
      ids.length ? input.lectureId : undefined,
      written,
    )
    const url = view ? lectureUrl(view.deck.permalinkSlug, ids[0]) : undefined
    return {
      text:
        `Added ${ids.length} slide${ids.length === 1 ? '' : 's'} to lecture ` +
        `${input.lectureId} (now ${count} slide${count === 1 ? '' : 's'}): ` +
        `${ids.join(', ')}${openAt(url)}.` +
        (fitReportText(issues) ?? ''),
      data: {
        added: ids,
        count,
        url: url ?? null,
        ...(issues.length ? { fit: issues } : {}),
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
    const url = lectureUrl(deck.permalinkSlug)
    return {
      text: `Reordered the ${deck.slideOrder.length} slides of lecture ${deck.id}${openAt(url)}.`,
      data: { id: deck.id, slideOrder: deck.slideOrder, url: url ?? null },
    }
  },
})

/**
 * One slide's narration to set, as part of a set_slide_narration batch. The
 * cap on how many can land in a call matches the other batch tools above —
 * batching is the point (see the module docstring) — the 20,000-character
 * cap on the narration itself belongs to slide.editTranscript and is
 * reported by the action, not duplicated here.
 */
const narrationToSet = z.object({
  slideId: z.string().min(1).describe('The slide id, from read_lecture.'),
  narration: z
    .string()
    .describe(
      'The full spoken narration for this slide — the words the app reads ' +
        'aloud during playback (TTS). This is the lecture itself, not ' +
        'speaker notes. REPLACES whatever narration was there. Leave it ' +
        'empty (pass "") to clear it, which falls back to narrating the ' +
        'slide’s own title/body/bullets instead — the audience then hears ' +
        'the slide read aloud rather than a lecture. Up to 20,000 characters.',
    ),
})

export const setSlideNarration = defineTool({
  name: 'set_slide_narration',
  title: 'Set slide narration',
  description:
    'Sets the spoken narration — what the app reads aloud during playback — ' +
    'for one or more slides in one call. Prefer one call with several ' +
    'narrations over several calls. A slide built through add_slide or ' +
    'add_slides has NO narration until this is called, so the app falls ' +
    'back to reading the slide’s own content aloud: the audience hears the ' +
    'bullets read back to them instead of a lecture. This is not speaker ' +
    'notes and is not the slide’s displayed text — it is the words spoken ' +
    'while that slide is on screen. Each entry REPLACES the slide’s whole ' +
    'narration.',
  readOnly: false,
  uses: ['slide.editTranscript'],
  input: {
    narrations: z
      .array(narrationToSet)
      .min(1)
      .max(50)
      .describe('The narrations to set, in order.'),
  },
  run: async (call, input) => {
    const done: string[] = []
    for (const [i, entry] of input.narrations.entries()) {
      try {
        await call<Slide>('slide.editTranscript', {
          slideId: entry.slideId,
          transcript: entry.narration,
        })
        // The id this entry addressed, not a field off the action's return —
        // same convention edit_slides uses, so a batch's report names the
        // slides the caller asked about rather than whatever came back.
        done.push(entry.slideId)
      } catch (err) {
        // Same partial-failure convention as edit_slides/add_slides above —
        // not a second one invented for this tool.
        const succeeded = done.length
          ? `Set narration on ${done.length} of ${input.narrations.length} slide${input.narrations.length === 1 ? '' : 's'}: ${done.join(', ')}.`
          : `Set narration on none of the ${input.narrations.length} slides.`
        return {
          isError: true,
          text: partialFailureText({
            succeeded,
            total: input.narrations.length,
            failedIndex: i,
            err,
            notRepeat: done.length
              ? 'The narrations already set do not need to be repeated.'
              : undefined,
          }),
          data: { set: done, failedIndex: i },
        }
      }
    }
    return {
      text: `Set narration on ${done.length} slide${done.length === 1 ? '' : 's'}: ${done.join(', ')}.`,
      data: { set: done },
    }
  },
})

/** One part of a split_slide call — exactly the shape deck.splitSlide takes,
 * restated here rather than imported so the tool's own input schema (what
 * the SDK turns into JSON Schema for the model) is not tied to the action's
 * internal zod object. */
const splitSlidePart = z.object({
  layoutType: z
    .string()
    .min(1)
    .describe(
      'A layout name from the lecture’s template. Falls back to the ' +
        'original slide’s own layout if this name is not one of them.',
    ),
  slots: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      bullets: z.array(z.string()).optional(),
      caption: z.string().optional(),
    })
    .describe('This part’s content — write it out in full.'),
  imageGuidance: z
    .object({
      keywords: z
        .array(z.string())
        .describe('Search terms for this part’s own picture.'),
      none: z
        .boolean()
        .optional()
        .describe('Set true to skip finding an image for this part.'),
    })
    .optional()
    .describe(
      'Picture guidance for this part, if its layout has an image box.',
    ),
})

export const splitSlide = defineTool({
  name: 'split_slide',
  title: 'Split a slide into several',
  description:
    'Breaks one slide into two or more, each with the content you supply — ' +
    'the follow-up to a fit check (from add_slide, add_slides or ' +
    'edit_slides) reporting a slide over budget, since slide.delete is not ' +
    'available to just start over. The FIRST part replaces the original ' +
    'slide and keeps its id, so its narration and anything else tied to ' +
    'that id stays attached; the rest are inserted immediately after it. ' +
    'Nothing here is generated for you — write each part’s content in ' +
    'full, and expect the fit check to run again over what you wrote: a ' +
    'part that is still over budget is reported, not silently accepted as ' +
    'a fix.',
  readOnly: false,
  // Every call creates more slides — see McpTool.idempotent.
  idempotent: false,
  // deck.get supplies the template the fit check below reads real budgets
  // from, same as edit_slides/add_slide/add_slides.
  uses: ['deck.splitSlide', 'deck.get'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    slideId: z
      .string()
      .min(1)
      .describe('The slide id to split, from read_lecture.'),
    parts: z
      .array(splitSlidePart)
      .min(2)
      .max(MAX_SPLIT_PARTS)
      .describe(
        `The resulting slides, in order the first replaces the original. At least 2, at most ${MAX_SPLIT_PARTS}.`,
      ),
  },
  run: async (call, input) => {
    const result = await call<DeckSplitSlideResult>('deck.splitSlide', {
      deckId: input.lectureId,
      slideId: input.slideId,
      parts: input.parts,
    })
    const all = [result.slide, ...result.added]
    // Checked against what was actually asked to be written, in the order
    // the parts land (first keeps the original id, the rest follow it) —
    // same fit check add_slide/add_slides/edit_slides run over their own
    // writes, so a part that is still over budget is reported here too.
    const written: Written[] = all.map((slide, i) => ({
      slideId: slide.id,
      content: input.parts[i]!.slots,
      layoutType: slide.layoutType,
    }))
    const { view, issues } = await withFit(call, input.lectureId, written)
    const url = view
      ? lectureUrl(view.deck.permalinkSlug, result.slide.id)
      : undefined
    const ids = all.map(s => s.id)
    return {
      text:
        `Split slide ${input.slideId} into ${all.length} slides: ${ids.join(', ')}${openAt(url)}.` +
        (fitReportText(issues) ?? ''),
      data: {
        slide: result.slide.id,
        added: result.added.map(s => s.id),
        slideOrder: result.slideOrder,
        url: url ?? null,
        ...(issues.length ? { fit: issues } : {}),
      },
    }
  },
})

registerTool(editSlides)
registerTool(addSlide)
registerTool(addSlides)
registerTool(reorderSlides)
registerTool(setSlideNarration)
registerTool(splitSlide)
