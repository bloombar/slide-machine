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
import { defineTool } from '../tool'
import { registerTool } from '../registry'
import { onDay, openAt, projectName } from './prose'
import { lectureUrl } from '../../lib/deck-link'

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
          : 'This account has no lectures yet. Use create_lecture to make one.',
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

/** One slide as a line: enough to decide whether to edit it, and its id. */
const slideLine = (slide: Slide, position: number): string => {
  const parts = [`${position}. [${slide.layoutType}] (slide id: ${slide.id})`]
  if (slide.title) parts.push(`title: ${slide.title}`)
  if (slide.bullets?.length) parts.push(`bullets: ${slide.bullets.join(' · ')}`)
  if (slide.body) parts.push(`body: ${slide.body}`)
  if (slide.caption) parts.push(`caption: ${slide.caption}`)
  return parts.join('\n   ')
}

export const readLecture = defineTool({
  name: 'read_lecture',
  title: 'Read a lecture',
  description:
    'Returns one lecture in full: its settings, its seed notes, every slide in ' +
    'order with the slide id, layout and content of each, and the address the ' +
    'lecture can be opened at. This is the only way to get slide ids, so call ' +
    'it before editing or reordering slides.',
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
        seedContext: deck.seedContext ?? null,
        slides: slides.map(slide => ({
          id: slide.id,
          index: slide.index,
          layoutType: slide.layoutType,
          title: slide.title ?? null,
          body: slide.body ?? null,
          bullets: slide.bullets ?? [],
          caption: slide.caption ?? null,
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
    'slides; use set_lecture_notes to give it the material it should be ' +
    'built from.',
  readOnly: false,
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
        `in project ${deck.projectId}${openAt(url)}. It has no slides yet.`,
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
  description: 'Changes a lecture’s title. Nothing else about it changes.',
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
    'Replaces a lecture’s seed notes — the background material the app uses ' +
    'when generating and refining its slides. This is the tool for handing ' +
    'over a syllabus section, a reading summary, or an outline the app has ' +
    'never seen. It REPLACES the existing notes rather than appending, so read ' +
    'the lecture first if you mean to add to them.',
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
    return {
      text: input.notes
        ? `Set ${input.notes.length} characters of seed notes on lecture ${deck.id}, replacing whatever was there${openAt(url)}.`
        : `Cleared the seed notes on lecture ${deck.id}${openAt(url)}.`,
      data: { id: deck.id, url: url ?? null },
    }
  },
})

registerTool(findLectures)
registerTool(readLecture)
registerTool(createLecture)
registerTool(renameLecture)
registerTool(setLectureNotes)
