/**
 * Finding the projects a lecture can go into (docs/MCP.md §4.1).
 *
 * A lecture is always created inside a project, and which one is not a
 * detail an agent should settle on its own. Projects are how an instructor
 * separates one course from another, so putting Tuesday's lecture in last
 * term's project is not a tidiness problem — it is material filed where the
 * people who need it will not look, and where the wrong people might.
 *
 * `create_lecture` has always required a project id. What was missing was any
 * way to learn one: it pointed at `find_lectures`, which lists lectures, so an
 * account with no lectures yet had no route to a project id at all — the exact
 * moment someone is most likely to be creating their first one. This tool is
 * that route, and it exists so the assistant can put the choice to the
 * instructor rather than guess at it.
 *
 * `create_project` closes the other half: an instructor starting a new course
 * had to leave the assistant and open the app. It is a create, not a destroy,
 * and it neither spends nor reaches anyone else, so the §6 grounds for
 * withholding it do not apply. One asymmetry is worth stating plainly in its
 * description rather than leaving a model to discover it: `project.delete`
 * stays forbidden, so a project made here is one the agent cannot take back.
 * That is why the tool is told to offer what already exists first — the cost
 * of a duplicate is not a stray record but a course whose lectures are split
 * across two places.
 */
import { z } from 'zod'
import type { Project } from '@slide-machine/shared'
import { defineTool } from '../tool'
import { registerTool } from '../registry'
import { onDay, projectName } from './prose'

/** One project as a line of prose, id included. */
const projectLine = (project: Project): string => {
  const parts = [
    `- "${projectName(project.title)}" (project id: ${project.id})`,
  ]
  if (project.course) parts.push(`course: ${project.course}`)
  if (project.description) parts.push(`description: ${project.description}`)
  parts.push(`last changed ${onDay(project.updatedAt)}`)
  return parts.join(' — ')
}

export const findProjects = defineTool({
  name: 'find_projects',
  title: 'Find projects',
  description:
    'Lists the projects this account owns, most recently changed first, with ' +
    'the id of each. A project is the course or unit a lecture belongs to. ' +
    'Call this before create_lecture and ask the instructor which project the ' +
    'new lecture belongs in — do not choose for them.',
  readOnly: true,
  uses: ['project.list'],
  input: {
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'Match projects whose title or course contains this text (case-insensitive).',
      ),
  },
  run: async (call, input) => {
    const projects = await call<Project[]>('project.list', {})

    const needle = input.query?.toLowerCase()
    const matches = needle
      ? projects.filter(
          project =>
            project.title.toLowerCase().includes(needle) ||
            (project.course ?? '').toLowerCase().includes(needle),
        )
      : projects

    if (matches.length === 0) {
      return {
        text: needle
          ? `No project of this account matches "${input.query}". There are ${projects.length} projects in total; call again without a query to see them.`
          : 'This account has no projects yet. A lecture must live in one, so ask the instructor what this project should be called, then use create_project.',
        data: { projects: [] },
      }
    }

    return {
      text: [
        `${matches.length} project${matches.length === 1 ? '' : 's'}:`,
        ...matches.map(projectLine),
        '',
        'Ask the instructor which of these a new lecture belongs in.',
      ].join('\n'),
      data: {
        projects: matches.map(project => ({
          id: project.id,
          title: project.title,
          course: project.course ?? null,
          description: project.description ?? null,
          updatedAt: project.updatedAt,
        })),
      },
    }
  },
})

export const createProject = defineTool({
  name: 'create_project',
  title: 'Create a project',
  description:
    'Creates a new project — the course or unit that lectures are filed ' +
    'under. Use this only when the instructor has said they want a new one. ' +
    'Call find_projects first and offer what already exists: a second ' +
    'project for a course that already has one splits its lectures across ' +
    'two places. Nothing here can delete a project, so one made by mistake ' +
    'has to be cleared up by hand in the app.',
  readOnly: false,
  uses: ['project.create'],
  input: {
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('What the project is called, e.g. "Algorithms, Autumn 2026".'),
    course: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('The course code, if there is one, e.g. "CS-201".'),
    description: z
      .string()
      .trim()
      .max(2_000)
      .optional()
      .describe('What the course covers, in a sentence or two.'),
  },
  run: async (call, input) => {
    const project = await call<Project>('project.create', {
      title: input.title,
      ...(input.course ? { course: input.course } : {}),
      ...(input.description ? { description: input.description } : {}),
    })
    return {
      text:
        `Created project "${projectName(project.title)}" (project id: ${project.id}). ` +
        `Pass that id to create_lecture to file a lecture under it. ` +
        `This project is visible to ${project.visibility === 'public' ? 'anyone with the link' : 'this account only'}; ` +
        `changing that is done in the app, not from here.`,
      data: {
        id: project.id,
        title: project.title,
        course: project.course ?? null,
        description: project.description ?? null,
        visibility: project.visibility,
      },
    }
  },
})

registerTool(findProjects)
registerTool(createProject)
