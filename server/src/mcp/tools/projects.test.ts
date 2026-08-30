/**
 * Unit tests for the project tools (docs/MCP.md §4.1).
 */
import { describe, expect, it } from 'vitest'
import type { ActionCaller } from '../tool'
import { findProjects } from './projects'
import { createLecture } from './lectures'

const fakeCall = (
  answers: Record<string, unknown>,
): ActionCaller & { calls: [string, unknown][] } => {
  const calls: [string, unknown][] = []
  const call = (async (action: string, input: unknown) => {
    calls.push([action, input])
    return answers[action]
  }) as ActionCaller & { calls: [string, unknown][] }
  call.calls = calls
  return call
}

const project = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'p1',
  title: 'Algorithms',
  course: 'CS-201',
  description: undefined,
  updatedAt: '2026-08-20T10:00:00.000Z',
  ...over,
})

describe('find_projects', () => {
  it('names each project with the id create_lecture needs', async () => {
    const call = fakeCall({ 'project.list': [project()] })
    const out = await findProjects.run(call, {})

    expect(call.calls).toEqual([['project.list', {}]])
    expect(out.text).toContain('project id: p1')
    expect(out.text).toContain('Algorithms')
    expect(out.text).toContain('course: CS-201')
    expect(out.data).toEqual({
      projects: [
        {
          id: 'p1',
          title: 'Algorithms',
          course: 'CS-201',
          description: null,
          updatedAt: '2026-08-20T10:00:00.000Z',
        },
      ],
    })
  })

  it('tells the model to put the choice to the instructor', async () => {
    // The whole point of the tool: the id is for asking with, not for
    // choosing with.
    const call = fakeCall({
      'project.list': [project(), project({ id: 'p2' })],
    })
    const out = await findProjects.run(call, {})
    expect(out.text).toContain('Ask the instructor which of these')
  })

  it('names an untitled project rather than printing an empty one', async () => {
    const call = fakeCall({ 'project.list': [project({ title: '' })] })
    const out = await findProjects.run(call, {})
    expect(out.text).toContain('Untitled project')
    expect(out.text).not.toContain('""')
  })

  it('counts a single project in the singular', async () => {
    const call = fakeCall({ 'project.list': [project()] })
    const out = await findProjects.run(call, {})
    expect(out.text).toContain('1 project:')
  })

  it('filters by title or course, case-insensitively', async () => {
    const call = fakeCall({
      'project.list': [
        project(),
        project({ id: 'p2', title: 'Databases', course: 'CS-305' }),
      ],
    })
    const byTitle = await findProjects.run(call, { query: 'algo' })
    expect(byTitle.text).toContain('project id: p1')
    expect(byTitle.text).not.toContain('project id: p2')

    const byCourse = await findProjects.run(call, { query: 'cs-305' })
    expect(byCourse.text).toContain('project id: p2')
    expect(byCourse.text).not.toContain('project id: p1')
  })

  it('says how many exist when a query matches none', async () => {
    const call = fakeCall({
      'project.list': [project(), project({ id: 'p2' })],
    })
    const out = await findProjects.run(call, { query: 'nothing' })
    expect(out.text).toContain('There are 2 projects in total')
    expect(out.data).toEqual({ projects: [] })
  })

  it('tells an account with no projects to ask before creating anything', async () => {
    const call = fakeCall({ 'project.list': [] })
    const out = await findProjects.run(call, {})
    expect(out.text).toContain('no projects yet')
    expect(out.text).toContain('ask the instructor')
  })

  it('reads a project with no date without inventing one', async () => {
    const call = fakeCall({
      'project.list': [project({ updatedAt: undefined })],
    })
    const out = await findProjects.run(call, {})
    expect(out.text).toContain('last changed unknown')
  })

  it('cannot reach any action beyond listing projects', () => {
    expect(findProjects.uses).toEqual(['project.list'])
    expect(findProjects.readOnly).toBe(true)
  })
})

describe('create_lecture, on choosing a project', () => {
  it('sends the model to find_projects and tells it to ask', async () => {
    // create_lecture used to point at find_lectures, which lists lectures —
    // an account with none had no route to a project id at all.
    expect(createLecture.description).toContain('find_projects')
    expect(createLecture.description).toContain('ask the instructor')
    expect(createLecture.description).not.toContain('from find_lectures')
  })

  it('still files the lecture in exactly the project it was given', async () => {
    const call = fakeCall({
      'deck.create': { id: 'd1', title: 'Week 4', projectId: 'p2' },
    })
    const out = await createLecture.run(call, {
      projectId: 'p2',
      title: 'Week 4',
    })
    expect(call.calls).toEqual([
      ['deck.create', { projectId: 'p2', title: 'Week 4' }],
    ])
    expect(out.data).toEqual({ id: 'd1', title: 'Week 4', projectId: 'p2' })
  })
})
