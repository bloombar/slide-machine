/**
 * Finding, reading, and preparing lectures (docs/MCP.md §4.1).
 *
 * These are the tools the rest depend on. An agent has no screen and no
 * selection: it cannot get from "Tuesday's lecture" to a deck id the way a
 * person clicking a list can, so a server whose read tools are an afterthought
 * produces an assistant that cannot edit anything because it cannot find
 * anything. Every write tool here takes an id, and every id an agent will ever
 * hold came out of `find_lectures` or `read_lecture`.
 *
 * That is also why the prose these return carries ids inline rather than
 * leaving them to structured output alone: the model reasons over the text.
 */
import { z } from 'zod'
import type {
  Deck,
  DeckViewResponse,
  Project,
  Slide,
} from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import { defineTool } from '../tool'
import { registerTool } from '../registry'
import { onDay, openAt, projectName } from './prose'
import { lectureUrl } from '../../lib/deck-link'
import { ttsVoiceIdSchema } from '../../lib/tts-voice'
import { WRITABLE_FIELDS } from './fit-report'

/** One lecture as a line of prose, ids included. */
const lectureLine = (deck: Deck, projectTitle: string | undefined): string =>
  `- "${deck.title || 'Untitled lecture'}" (lecture id: ${deck.id}) — ` +
  `${deck.slideOrder.length} slide${deck.slideOrder.length === 1 ? '' : 's'}, ` +
  `in project "${projectName(projectTitle)}" (project id: ${deck.projectId}), ` +
  `last changed ${onDay(deck.updatedAt)}` +
  openAt(lectureUrl(deck.permalinkSlug))

export const findLectures = defineTool({
  name: 'find_lectures',
  title: 'Find lectures',
  description:
    'Lists the lectures this account owns, newest first, with the id of each ' +
    'one, the project it belongs to, and the address it can be opened at. Call ' +
    'this first: every other tool needs a lecture id, and this is where ids ' +
    'come from. Optionally filter by a word from the lecture or project title.',
  readOnly: true,
  uses: ['deck.list', 'project.list'],
  input: {
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'Match lectures whose title, or whose project title, contains this text (case-insensitive).',
      ),
  },
  run: async (call, input) => {
    const [decks, projects] = await Promise.all([
      call<Deck[]>('deck.list', {}),
      call<Project[]>('project.list', {}),
    ])
    const titleOf = new Map(projects.map(p => [p.id, p.title]))

    const needle = input.query?.toLowerCase()
    const matches = needle
      ? decks.filter(
          deck =>
            deck.title.toLowerCase().includes(needle) ||
            (titleOf.get(deck.projectId) ?? '').toLowerCase().includes(needle),
        )
      : decks

    if (matches.length === 0) {
      return {
        text: needle
          ? `No lecture of this account matches "${input.query}". There are ${decks.length} lectures in total; call again without a query to see them.`
          : 'This account has no lectures yet. Use create_lecture to make one ' +
            '— it starts empty, with no slides, until add_slide is called.',
        data: { lectures: [] },
      }
    }

    return {
      text: [
        `${matches.length} lecture${matches.length === 1 ? '' : 's'}:`,
        ...matches.map(deck => lectureLine(deck, titleOf.get(deck.projectId))),
      ].join('\n'),
      data: {
        lectures: matches.map(deck => ({
          id: deck.id,
          title: deck.title,
          projectId: deck.projectId,
          projectTitle: titleOf.get(deck.projectId) ?? null,
          slideCount: deck.slideOrder.length,
          updatedAt: deck.updatedAt,
          url: lectureUrl(deck.permalinkSlug) ?? null,
        })),
      },
    }
  },
})

/** The slot names on a slide this tool surface cannot write — everything in
 * its `slots` map besides the four conventional fields (WRITABLE_FIELDS,
 * fit-report.ts). Read-only surfacing of what #383's fit check already
 * enforces: an "image" box, or a template author's own box name
 * (big-number's figure/label), exists and is filled in the app, not
 * through add_slide/add_slides/edit_slides. */
const otherSlotsOf = (slide: Slide): string[] =>
  Object.keys(slide.slots ?? {}).filter(
    n => !(WRITABLE_FIELDS as readonly string[]).includes(n),
  )

/** One slide as a line: enough to decide whether to edit it, and its id.
 * Narration is reported by presence and length only — never the transcript
 * text itself, which on a forty-slide lecture would bury everything else in
 * the answer. */
const slideLine = (slide: Slide, position: number): string => {
  const parts = [`${position}. [${slide.layoutType}] (slide id: ${slide.id})`]
  if (slide.title) parts.push(`title: ${slide.title}`)
  if (slide.bullets?.length) parts.push(`bullets: ${slide.bullets.join(' · ')}`)
  if (slide.body) parts.push(`body: ${slide.body}`)
  if (slide.caption) parts.push(`caption: ${slide.caption}`)
  const narrationLength = slide.sourceTranscript?.length ?? 0
  parts.push(
    narrationLength
      ? `narration: ${narrationLength} characters set (use set_slide_narration to replace it)`
      : 'narration: none set — the app narrates this slide’s own content aloud instead',
  )
  const otherSlots = otherSlotsOf(slide)
  if (otherSlots.length) {
    parts.push(
      `other boxes on this layout, not writable from here: ${otherSlots.join(', ')}`,
    )
  }
  if (slide.manuallyEdited) parts.push('manually edited: yes')
  return parts.join('\n   ')
}

export const readLecture = defineTool({
  name: 'read_lecture',
  title: 'Read a lecture',
  description:
    'Returns one lecture in full: its settings (language, AI freedom, ' +
    'narration voice), its seed notes, every slide in order with the slide ' +
    'id, layout, content and narration status of each, and the address the ' +
    'lecture can be opened at. This is the only way to get slide ids, so ' +
    'call it before editing or reordering slides.',
  readOnly: true,
  uses: ['deck.get'],
  input: {
    lectureId: z
      .string()
      .min(1)
      .describe('The lecture id, as returned by find_lectures.'),
  },
  run: async (call, input) => {
    const view = await call<DeckViewResponse>('deck.get', {
      deckId: input.lectureId,
    })
    const { deck, slides, template } = view

    const url = lectureUrl(deck.permalinkSlug)
    const header = [
      `Lecture "${deck.title || 'Untitled lecture'}" (lecture id: ${deck.id})`,
      `Project: "${projectName(view.project.title)}" (project id: ${view.project.id})`,
      `Template: ${template.name} (template id: ${deck.templateId})`,
      `Visibility: ${deck.visibility}${deck.accessInherited ? ' (inherited from the project)' : ''}`,
      `Slides: ${slides.length}`,
      view.canEdit
        ? 'This account may edit this lecture.'
        : 'This account may only read this lecture; edits will be refused.',
      // What an assistant is now expected to respect (this slice): the
      // instructor's own settings, invisible until read here. `set` tells
      // the model this connection can change them; the value governs the
      // app's OWN later generation (Refine, Reformat, auto-narration), not
      // what this connection writes directly — but it is still the
      // instructor's standing policy, so treat it as one anyway.
      `Language: ${deck.language ?? 'not set — inherits the project, then the owner’s profile, then the browser'}. Write new titles, bullets, body text and narration for this lecture in this language. Set with set_lecture_settings.`,
      `AI content freedom: ${deck.generationFreedom ?? 'not set — inherits the project, or 5 by default'} on a 1-5 scale (1 = slides may contain only what the speaker explicitly said, 5 = the AI may elaborate freely). This governs the app’s own later generation, not what this connection writes directly, but it is the instructor’s standing policy — write and narrate to the same standard. Set with set_lecture_settings.`,
      `Narration voice: ${deck.ttsVoice ?? 'not set — inherits the project’s'}. Set with set_lecture_settings.`,
      deck.titleLocked
        ? 'Title: locked by a hand-entered title; the app’s own auto-titling will not rename it.'
        : 'Title: not locked; the app may auto-title this lecture until someone names it by hand.',
    ]
    // One address and the rule for pointing it at a slide, rather than a URL
    // on every slide line — a forty-slide lecture would spend most of this
    // answer repeating the same prefix.
    if (url) {
      header.push(
        `Open in the app: ${url} — the instructor must be signed in, and ` +
          `adding "?slide=<slide id>" to that address opens one slide. Offer ` +
          `this link when the instructor should look at something.`,
      )
    }
    if (deck.seedContext) {
      header.push(`Seed notes:\n${deck.seedContext}`)
    }

    return {
      text: [
        ...header,
        '',
        slides.length
          ? slides.map((slide, i) => slideLine(slide, i + 1)).join('\n')
          : 'This lecture has no slides yet.',
      ].join('\n'),
      data: {
        id: deck.id,
        title: deck.title,
        url: url ?? null,
        projectId: deck.projectId,
        templateId: deck.templateId,
        visibility: deck.visibility,
        canEdit: view.canEdit,
        language: deck.language ?? null,
        generationFreedom: deck.generationFreedom ?? null,
        ttsVoice: deck.ttsVoice ?? null,
        titleLocked: Boolean(deck.titleLocked),
        seedContext: deck.seedContext ?? null,
        slides: slides.map(slide => ({
          id: slide.id,
          index: slide.index,
          layoutType: slide.layoutType,
          title: slide.title ?? null,
          body: slide.body ?? null,
          bullets: slide.bullets ?? [],
          caption: slide.caption ?? null,
          hasNarration: Boolean(slide.sourceTranscript),
          narrationLength: slide.sourceTranscript?.length ?? 0,
          otherSlots: otherSlotsOf(slide),
          manuallyEdited: Boolean(slide.manuallyEdited),
          url: lectureUrl(deck.permalinkSlug, slide.id) ?? null,
        })),
      },
    }
  },
})

export const createLecture = defineTool({
  name: 'create_lecture',
  title: 'Create a lecture',
  description:
    'Creates an empty lecture inside a project. Needs a project id: call ' +
    'find_projects and ask the instructor which project this lecture belongs ' +
    'in. Do not pick one yourself, and do not reuse a project id from an ' +
    'earlier lecture without checking — filing a lecture under the wrong ' +
    'course is not something this tool can undo. The lecture starts with no ' +
    'slides and stays that way until add_slides (or add_slide, once per ' +
    'slide) is called — add_slides in one call is the normal way a deck gets ' +
    'built. set_lecture_notes is separate and optional: it stores background ' +
    'material for the instructor to use in the app later, and nothing ' +
    'reachable on this connection turns it into slides — not when you set ' +
    'it, and not afterwards.',
  readOnly: false,
  // A new lecture every call, not a value replaced — see McpTool.idempotent.
  idempotent: false,
  uses: ['deck.create'],
  input: {
    projectId: z
      .string()
      .min(1)
      .describe(
        'The project the lecture belongs to, from find_projects and confirmed with the instructor.',
      ),
    title: z
      .string()
      .trim()
      .max(200)
      .describe('What the lecture is called, e.g. "Week 4 — Recursion".'),
  },
  run: async (call, input) => {
    const deck = await call<Deck>('deck.create', {
      projectId: input.projectId,
      title: input.title,
    })
    const url = lectureUrl(deck.permalinkSlug)
    return {
      text:
        `Created lecture "${deck.title || 'Untitled lecture'}" (lecture id: ${deck.id}) ` +
        `in project ${deck.projectId}${openAt(url)}. It has no slides yet, and ` +
        'nothing will add any on its own: call add_slides to add them all in ' +
        'one call, or add_slide once per slide for just one. Do not tell the ' +
        'instructor it is ready before those calls are made.',
      data: {
        id: deck.id,
        title: deck.title,
        projectId: deck.projectId,
        url: url ?? null,
      },
    }
  },
})

export const renameLecture = defineTool({
  name: 'rename_lecture',
  title: 'Rename a lecture',
  description:
    'Changes a lecture’s title. A non-empty title locks it: the app’s own ' +
    'auto-titling will not rename the lecture again. Clearing the title back ' +
    'to an empty string hands that control back to auto-titling.',
  readOnly: false,
  uses: ['deck.rename'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    title: z.string().trim().max(200).describe('The new title.'),
  },
  run: async (call, input) => {
    const deck = await call<Deck>('deck.rename', {
      deckId: input.lectureId,
      title: input.title,
    })
    const url = lectureUrl(deck.permalinkSlug)
    return {
      text: `Renamed lecture ${deck.id} to "${deck.title || 'Untitled lecture'}"${openAt(url)}.`,
      data: { id: deck.id, title: deck.title, url: url ?? null },
    }
  },
})

export const setLectureNotes = defineTool({
  name: 'set_lecture_notes',
  title: 'Set a lecture’s seed notes',
  description:
    'Replaces a lecture’s seed notes. Setting them creates no slides, and ' +
    'nothing reachable on this connection generates slides from them: the ' +
    'notes are only read when the instructor teaches the lecture live in the ' +
    'app, and when refining slides that already exist. This is the tool for ' +
    'handing over a syllabus section, a reading summary, or an outline the ' +
    'app has never seen — not a way to build a deck. Building a deck means ' +
    'calling add_slides (or add_slide, once per slide). It REPLACES the ' +
    'existing notes rather than appending, so read the lecture first if you ' +
    'mean to add to them.',
  readOnly: false,
  uses: ['deck.setSeedNotes'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    notes: z
      .string()
      .max(20_000)
      .describe(
        'The full seed notes, as plain text. Pass an empty string to clear them.',
      ),
  },
  run: async (call, input) => {
    const deck = await call<Deck>('deck.setSeedNotes', {
      deckId: input.lectureId,
      seedContext: input.notes,
    })
    const url = lectureUrl(deck.permalinkSlug)
    // The count comes off the deck this call returned, not a cached read, so
    // a caller that expected notes to add slides sees the true number here —
    // at the exact turn a client might otherwise report the deck as done.
    const slideCount = deck.slideOrder.length
    const slideNote = `Lecture ${deck.id} has ${slideCount} slide${slideCount === 1 ? '' : 's'}; no slides were created by this call.`
    return {
      text: input.notes
        ? `Set ${input.notes.length} characters of seed notes on lecture ${deck.id}, replacing whatever was there${openAt(url)}. ${slideNote}`
        : `Cleared the seed notes on lecture ${deck.id}${openAt(url)}. ${slideNote}`,
      data: { id: deck.id, url: url ?? null },
    }
  },
})

/**
 * One tool for the three settings an instructor sets on a lecture, rather
 * than three tools each doing one field: three entries in every context
 * window for something set once is a worse trade than one entry with three
 * optional fields. Every field is optional; only the ones passed are
 * applied, which is asserted call-for-call in the tests below.
 */
export const setLectureSettings = defineTool({
  name: 'set_lecture_settings',
  title: 'Set lecture settings',
  description:
    'Sets a lecture’s language, AI content freedom, and narration voice — ' +
    'the instructor’s own policy for the app, invisible to an assistant ' +
    'until set or read here. Every field is optional; only the fields you ' +
    'pass are applied, and any left out are unchanged. One call handles ' +
    'all three, since setting them once should not cost three tool calls. ' +
    '`generationFreedom` is 1-5: 1 means the app’s own generation may add ' +
    'only what the speaker explicitly said, 5 means it may elaborate ' +
    'freely; it governs the app’s LATER generation (Refine, Reformat, ' +
    'auto-narration), not what this tool itself writes, but it is the ' +
    'instructor’s standing policy and every edit made on this connection ' +
    'should honor it too. `language` is one of the app’s supported ' +
    'locales. `ttsVoice` is one of the app’s narration voices.',
  readOnly: false,
  uses: ['deck.setLanguage', 'deck.setGenerationFreedom', 'deck.setTtsVoice'],
  input: {
    lectureId: z.string().min(1).describe('The lecture id.'),
    language: z
      .enum(LOCALES)
      .optional()
      .describe('The lecture’s language. Omit to leave it unchanged.'),
    generationFreedom: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        'The lecture’s AI content freedom, 1 (only what was said) to 5 ' +
          '(elaborate freely). Omit to leave it unchanged.',
      ),
    ttsVoice: ttsVoiceIdSchema
      .optional()
      .describe(
        'The lecture’s narration voice id. Omit to leave it unchanged.',
      ),
  },
  run: async (call, input) => {
    const { lectureId, language, generationFreedom, ttsVoice } = input
    const changes: string[] = []
    // Whichever setter ran last already carries the full, current deck —
    // no separate deck.get needed just for the link (unlike the batch
    // tools in slides.ts, which have no such deck in hand until they ask).
    let deck: Deck | undefined
    if (language !== undefined) {
      deck = await call<Deck>('deck.setLanguage', {
        deckId: lectureId,
        language,
      })
      changes.push(`language to "${language}"`)
    }
    if (generationFreedom !== undefined) {
      deck = await call<Deck>('deck.setGenerationFreedom', {
        deckId: lectureId,
        freedom: generationFreedom,
      })
      changes.push(`AI freedom to ${generationFreedom}`)
    }
    if (ttsVoice !== undefined) {
      deck = await call<Deck>('deck.setTtsVoice', {
        deckId: lectureId,
        voice: ttsVoice,
      })
      changes.push(`narration voice to "${ttsVoice}"`)
    }
    if (!changes.length) {
      return {
        text:
          `No settings were passed for lecture ${lectureId}, so nothing ` +
          'changed. Pass language, generationFreedom and/or ttsVoice to set them.',
        data: { id: lectureId, changed: [] },
      }
    }
    const url = deck ? lectureUrl(deck.permalinkSlug) : undefined
    return {
      text: `Updated lecture ${lectureId}: set ${changes.join(', ')}${openAt(url)}.`,
      data: {
        id: lectureId,
        url: url ?? null,
        language: deck?.language ?? null,
        generationFreedom: deck?.generationFreedom ?? null,
        ttsVoice: deck?.ttsVoice ?? null,
      },
    }
  },
})

registerTool(findLectures)
registerTool(readLecture)
registerTool(createLecture)
registerTool(renameLecture)
registerTool(setLectureNotes)
registerTool(setLectureSettings)
