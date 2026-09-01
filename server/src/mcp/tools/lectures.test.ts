/**
 * Unit tests for the lecture tools (docs/MCP.md §4.1).
 *
 * Each tool is exercised against a fake `call`, so what is under test is the
 * only part that is ours: which actions a tool dispatches, with what input,
 * and whether the prose it returns carries the ids a model needs to make the
 * next call. The actions themselves are tested where they live.
 */
import { describe, expect, it } from 'vitest'
import type { ActionCaller } from '../tool'
import {
  createLecture,
  findLectures,
  readLecture,
  renameLecture,
  setLectureNotes,
} from './lectures'

/** A `call` that answers from a table of canned results, and records calls. */
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

const deck = {
  id: 'deck-1',
  projectId: 'proj-1',
  // The address the lecture opens at is built from this. `PUBLIC_BASE_URL` is
  // set for the whole suite in vitest.config.ts, so the URLs asserted below
  // are the ones a tool would really hand an assistant.
  permalinkSlug: 'week-4-recursion',
  title: 'Week 4 — Recursion',
  slideOrder: ['slide-1', 'slide-2'],
  updatedAt: '2026-08-20T10:00:00.000Z',
  templateId: 'classic',
  visibility: 'restricted',
  accessInherited: true,
}

describe('find_lectures', () => {
  it('lists lectures with their ids and their project’s name', async () => {
    const call = fakeCall({
      'deck.list': [deck],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, {})

    expect(out.text).toContain('deck-1')
    expect(out.text).toContain('Week 4 — Recursion')
    expect(out.text).toContain('CS 101')
    expect(out.text).toContain('2 slides')
    expect(out.data).toMatchObject({ lectures: [{ id: 'deck-1' }] })
  })

  it('gives each lecture an address the instructor can open', async () => {
    // An assistant cannot see slides, so a link is the only way it can show
    // its work — and it must not have to assemble one itself.
    const call = fakeCall({
      'deck.list': [deck],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, {})

    expect(out.text).toContain('http://localhost:3000/d/week-4-recursion')
    expect(out.data).toMatchObject({
      lectures: [{ url: 'http://localhost:3000/d/week-4-recursion' }],
    })
  })

  it('leaves the link out rather than printing a broken one', async () => {
    // A deck with no permalink is not a lecture anyone can open; the line
    // must still read as a sentence.
    const call = fakeCall({
      'deck.list': [{ ...deck, permalinkSlug: '' }],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, {})

    expect(out.text).not.toContain('undefined')
    expect(out.text).not.toContain('open at')
    expect(out.text).toContain('deck-1')
  })

  it('filters on the lecture title, case-insensitively', async () => {
    const call = fakeCall({
      'deck.list': [deck, { ...deck, id: 'deck-2', title: 'Week 5 — Trees' }],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, { query: 'RECURSION' })

    expect(out.text).toContain('deck-1')
    expect(out.text).not.toContain('deck-2')
  })

  it('filters on the project title too, since that is how people refer to them', async () => {
    const call = fakeCall({
      'deck.list': [deck],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, { query: 'cs 101' })
    expect(out.text).toContain('deck-1')
  })

  it('says how many lectures exist when the filter matched none', async () => {
    // A bare "no results" invites the model to conclude the account is empty
    // and stop; the count tells it to widen the query instead.
    const call = fakeCall({
      'deck.list': [deck],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, { query: 'thermodynamics' })

    expect(out.text).toContain('1 lectures in total')
    expect(out.data).toEqual({ lectures: [] })
  })

  it('points an empty account at the tool that fixes it', async () => {
    const call = fakeCall({ 'deck.list': [], 'project.list': [] })
    const out = await findLectures.run(call, {})
    expect(out.text).toContain('create_lecture')
  })

  it('reports a lecture whose project it cannot find, rather than hiding it', async () => {
    // Distinct from a project that merely has no title: this one was not in
    // the listing at all, which is a different fact about the data.
    const call = fakeCall({ 'deck.list': [deck], 'project.list': [] })
    const out = await findLectures.run(call, {})

    expect(out.text).toContain('unknown')
    expect(out.text).not.toContain('Untitled project')
    expect(out.text).toContain('deck-1')
  })

  it('still matches on the lecture title when the project is unnameable', async () => {
    const call = fakeCall({ 'deck.list': [deck], 'project.list': [] })
    const out = await findLectures.run(call, { query: 'recursion' })
    expect(out.text).toContain('deck-1')
  })

  it('treats an unnameable project as matching nothing, rather than everything', async () => {
    const call = fakeCall({ 'deck.list': [deck], 'project.list': [] })
    const out = await findLectures.run(call, { query: 'thermodynamics' })
    expect(out.data).toEqual({ lectures: [] })
  })

  it('counts several matches in the plural', async () => {
    const call = fakeCall({
      'deck.list': [
        deck,
        { ...deck, id: 'deck-2', title: 'Week 5 — Recursion II' },
      ],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, { query: 'recursion' })
    expect(out.text).toContain('2 lectures:')
  })

  it('names an untitled project rather than printing an empty quote', async () => {
    // A user's first project has no title of its own — real data, which the
    // fixtures above happened not to cover.
    const call = fakeCall({
      'deck.list': [deck],
      'project.list': [{ id: 'proj-1', title: '' }],
    })
    const out = await findLectures.run(call, {})

    expect(out.text).toContain('Untitled project')
    expect(out.text).not.toContain('project ""')
  })

  it('handles a lecture with no title and no recorded change date', async () => {
    const call = fakeCall({
      'deck.list': [
        { ...deck, title: '', updatedAt: undefined, slideOrder: ['s'] },
      ],
      'project.list': [{ id: 'proj-1', title: 'CS 101' }],
    })
    const out = await findLectures.run(call, {})
    expect(out.text).toContain('Untitled lecture')
    expect(out.text).toContain('1 slide,')
    expect(out.text).toContain('last changed unknown')
  })
})

describe('read_lecture', () => {
  const view = {
    deck: { ...deck, seedContext: 'Chapter 6: recursion and induction.' },
    slides: [
      {
        id: 'slide-1',
        index: 0,
        layoutType: 'title',
        title: 'Recursion',
        bullets: ['base case', 'recursive case'],
      },
      {
        id: 'slide-2',
        index: 1,
        layoutType: 'content',
        body: 'A function that calls itself.',
        caption: 'A tree unfolding',
      },
    ],
    template: { name: 'Classic', id: 'classic' },
    canEdit: true,
    project: { id: 'proj-1', title: 'CS 101' },
  }

  it('returns the lecture’s settings, its notes, and every slide id', async () => {
    const call = fakeCall({ 'deck.get': view })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(call.calls).toEqual([['deck.get', { deckId: 'deck-1' }]])
    expect(out.text).toContain('slide id: slide-1')
    expect(out.text).toContain('slide id: slide-2')
    expect(out.text).toContain('base case · recursive case')
    expect(out.text).toContain('A tree unfolding')
    expect(out.text).toContain('Chapter 6')
    expect(out.text).toContain('may edit')
  })

  it('gives the lecture’s address and the rule for opening one slide', async () => {
    // One address plus the rule, rather than a URL on every slide line: a
    // forty-slide lecture would otherwise spend most of this answer
    // repeating the same prefix.
    const call = fakeCall({ 'deck.get': view })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain('http://localhost:3000/d/week-4-recursion')
    expect(out.text).toContain('?slide=<slide id>')
    expect(out.text).toContain('signed in')
    // The prefix appears once, not once per slide.
    expect(out.text.split('/d/week-4-recursion').length - 1).toBe(1)
  })

  it('carries a per-slide address in the structured answer', async () => {
    const call = fakeCall({ 'deck.get': view })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.data).toMatchObject({
      url: 'http://localhost:3000/d/week-4-recursion',
      slides: [
        {
          id: 'slide-1',
          url: 'http://localhost:3000/d/week-4-recursion?slide=slide-1',
        },
        {
          id: 'slide-2',
          url: 'http://localhost:3000/d/week-4-recursion?slide=slide-2',
        },
      ],
    })
  })

  it('names an untitled project when reading a lecture too', async () => {
    const call = fakeCall({
      'deck.get': { ...view, project: { id: 'proj-1', title: '  ' } },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })
    expect(out.text).toContain('Untitled project')
  })

  it('warns when the account may only read, before an edit is attempted', async () => {
    const call = fakeCall({ 'deck.get': { ...view, canEdit: false } })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })
    expect(out.text).toContain('may only read')
  })

  it('reports an untitled lecture and its own privacy override', async () => {
    const call = fakeCall({
      'deck.get': {
        ...view,
        deck: {
          ...deck,
          title: '',
          accessInherited: false,
          visibility: 'public',
        },
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain('Untitled lecture')
    expect(out.text).toContain('Visibility: public')
    expect(out.text).not.toContain('inherited from the project')
  })

  it('lists a slide that has no content yet, so its id is still reachable', async () => {
    const call = fakeCall({
      'deck.get': {
        ...view,
        slides: [{ id: 'slide-9', index: 0, layoutType: 'content' }],
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })
    expect(out.text).toContain('slide id: slide-9')
    expect(out.text).toContain('[content]')
  })

  it('says a lecture is empty rather than returning a blank slide list', async () => {
    const call = fakeCall({
      'deck.get': { ...view, slides: [], deck: { ...deck, seedContext: '' } },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain('no slides yet')
    expect(out.text).not.toContain('Seed notes')
  })
})

describe('create_lecture', () => {
  it('creates inside the named project and hands back the new id', async () => {
    const call = fakeCall({ 'deck.create': deck })
    const out = await createLecture.run(call, {
      projectId: 'proj-1',
      title: 'Week 4 — Recursion',
    })

    expect(call.calls).toEqual([
      ['deck.create', { projectId: 'proj-1', title: 'Week 4 — Recursion' }],
    ])
    expect(out.text).toContain('deck-1')
    expect(out.text).toContain('no slides yet')
  })

  it('names an untitled lecture the way the app displays it', async () => {
    const call = fakeCall({ 'deck.create': { ...deck, title: '' } })
    const out = await createLecture.run(call, {
      projectId: 'proj-1',
      title: '',
    })
    expect(out.text).toContain('Untitled lecture')
  })
})

describe('rename_lecture', () => {
  it('renames and confirms the title that stuck', async () => {
    const call = fakeCall({
      'deck.rename': { ...deck, title: 'Week 4 — Induction' },
    })
    const out = await renameLecture.run(call, {
      lectureId: 'deck-1',
      title: 'Week 4 — Induction',
    })

    expect(call.calls).toEqual([
      ['deck.rename', { deckId: 'deck-1', title: 'Week 4 — Induction' }],
    ])
    expect(out.text).toContain('Week 4 — Induction')
  })

  it('reports a cleared title as the app displays it', async () => {
    const call = fakeCall({ 'deck.rename': { ...deck, title: '' } })
    const out = await renameLecture.run(call, {
      lectureId: 'deck-1',
      title: '',
    })
    expect(out.text).toContain('Untitled lecture')
  })
})

describe('set_lecture_notes', () => {
  it('replaces the notes and says so, since replacing is the surprising part', async () => {
    const call = fakeCall({ 'deck.setSeedNotes': deck })
    const out = await setLectureNotes.run(call, {
      lectureId: 'deck-1',
      notes: 'Chapter 6.',
    })

    expect(call.calls).toEqual([
      ['deck.setSeedNotes', { deckId: 'deck-1', seedContext: 'Chapter 6.' }],
    ])
    expect(out.text).toContain('replacing')
  })

  it('reports an empty string as clearing the notes, not as writing nothing', async () => {
    const call = fakeCall({ 'deck.setSeedNotes': deck })
    const out = await setLectureNotes.run(call, {
      lectureId: 'deck-1',
      notes: '',
    })
    expect(out.text).toContain('Cleared')
  })
})

describe('every lecture tool', () => {
  it('declares the actions it actually dispatches', async () => {
    // The fence in tool.ts refuses an undeclared action at runtime; this
    // catches the reverse — a `uses` entry that drifted from the code.
    const call = fakeCall({
      'deck.list': [],
      'project.list': [],
      'deck.get': {
        deck,
        slides: [],
        template: { name: 'Classic' },
        canEdit: true,
        project: { id: 'proj-1', title: 'CS 101' },
      },
      'deck.create': deck,
      'deck.rename': deck,
      'deck.setSeedNotes': deck,
    })
    const inputs = [
      [findLectures, {}],
      [readLecture, { lectureId: 'deck-1' }],
      [createLecture, { projectId: 'proj-1', title: 'x' }],
      [renameLecture, { lectureId: 'deck-1', title: 'x' }],
      [setLectureNotes, { lectureId: 'deck-1', notes: 'x' }],
    ] as const

    for (const [tool, input] of inputs) {
      call.calls.length = 0
      await (tool.run as (c: ActionCaller, i: unknown) => Promise<unknown>)(
        call,
        input,
      )
      for (const [action] of call.calls) {
        expect(tool.uses, `${tool.name} dispatched ${action}`).toContain(action)
      }
    }
  })
})
