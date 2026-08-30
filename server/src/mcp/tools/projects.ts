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
          : 'This account has no projects yet. A lecture must live in one, so ask the instructor what the project should be called before creating anything.',
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

registerTool(findProjects)
