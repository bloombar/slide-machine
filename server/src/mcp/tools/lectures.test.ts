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
  setLectureSettings,
} from './lectures'
import { listBuiltinTemplates } from '../../templates/builtin'

/** A minimal template shape that survives layoutDescriptors (needs
 * `layouts`/`theme`) without exercising real layout data — most read_lecture
 * tests below don't care what boxes a layout has. */
const emptyTemplate = { name: 'Classic', id: 'classic', layouts: [], theme: {} }

/** The real nyu-elegant template, for the one test that does care what boxes
 * a layout declares — verified by hand against
 * server/config/templates/nyu-elegant.json: big-number declares only
 * figure/label/caption, no title or body box at all. */
const nyuElegant = listBuiltinTemplates().find(t => t.id === 'nyu-elegant')!

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
    template: emptyTemplate,
    canEdit: true,
    project: { id: 'proj-1', title: 'CS 101' },
    // The resolved value this lecture uses while it has no override of its
    // own — deck.get always returns this, and read_lecture must report it
    // rather than guessing a default (MUST-FIX: it used to print 5 here).
    projectGenerationFreedom: 3,
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
    // The Visibility line itself must not claim inheritance — the AI
    // freedom line legitimately says "inherited from the project" too now,
    // so this checks the Visibility line specifically rather than the
    // phrase anywhere in the answer.
    expect(out.text).toContain('Visibility: public\n')
    expect(out.text).not.toContain('Visibility: public (inherited')
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

  it('reports language, AI freedom, narration voice and title lock when set', async () => {
    const call = fakeCall({
      'deck.get': {
        ...view,
        deck: {
          ...deck,
          language: 'es',
          generationFreedom: 2,
          ttsVoice: 'nova',
          titleLocked: true,
        },
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain('Language: es')
    expect(out.text).toContain('AI content freedom: 2 on a 1-5 scale')
    expect(out.text).toContain('Narration voice: nova')
    expect(out.text).toContain(
      'Title: locked by a hand-entered title; the app’s own auto-titling will not rename it.',
    )
    expect(out.data).toMatchObject({
      language: 'es',
      generationFreedom: 2,
      ttsVoice: 'nova',
      titleLocked: true,
    })
  })

  it('reports unset settings as inherited, and an unlocked title, rather than blank fields', async () => {
    const call = fakeCall({ 'deck.get': view })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain('Language: not set')
    // AI freedom always resolves to a real number (deck.get's
    // projectGenerationFreedom) — see the dedicated tests below for the
    // "inherited, not guessed" behavior; this fixture's project value is 3.
    expect(out.text).toContain(
      'AI content freedom: 3 (inherited from the project; this lecture has no override)',
    )
    expect(out.text).toContain('Narration voice: not set')
    expect(out.text).toContain(
      'Title: not locked; the app may auto-title this lecture until someone names it by hand.',
    )
    expect(out.data).toMatchObject({
      language: null,
      generationFreedom: null,
      effectiveGenerationFreedom: 3,
      ttsVoice: null,
      titleLocked: false,
    })
  })

  it('reports the resolved AI freedom, not a guessed default, when the lecture has no override', async () => {
    // MUST-FIX repro: a project set to freedom 1, a lecture with no override
    // of its own. The old code printed "not set — ... or 5 by default" here,
    // which told the assistant it could elaborate freely on a lecture
    // actually restricted to only what the speaker said — deck.get already
    // resolves this onto `projectGenerationFreedom` and it was ignored.
    const call = fakeCall({
      'deck.get': { ...view, projectGenerationFreedom: 1 },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain(
      'AI content freedom: 1 (inherited from the project; this lecture has no override) on a 1-5 scale',
    )
    expect(out.text).not.toContain('AI content freedom: 5')
    expect(out.text).not.toContain('AI content freedom: not set')
    expect(out.data).toMatchObject({
      generationFreedom: null,
      effectiveGenerationFreedom: 1,
    })
  })

  it('reports the lecture’s own AI freedom override, not the project’s, when one is set', async () => {
    const call = fakeCall({
      'deck.get': {
        ...view,
        deck: { ...deck, generationFreedom: 4 },
        projectGenerationFreedom: 1,
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain('AI content freedom: 4 on a 1-5 scale')
    expect(out.text).not.toContain(
      'AI content freedom: 4 (inherited from the project',
    )
    expect(out.data).toMatchObject({
      generationFreedom: 4,
      effectiveGenerationFreedom: 4,
    })
  })

  it('reports whether a slide has narration and how long it is, never the transcript text itself', async () => {
    // MUST-FIX: a test that only checks the length is present would pass on
    // an answer that also dumps the transcript — this one fails on that too.
    const narration =
      'This is the full spoken narration for the slide, several sentences ' +
      'long, and it must never appear verbatim in a read_lecture answer.'
    const call = fakeCall({
      'deck.get': {
        ...view,
        slides: [
          {
            id: 'slide-1',
            index: 0,
            layoutType: 'content',
            sourceTranscript: narration,
            slots: {},
          },
          {
            id: 'slide-2',
            index: 1,
            layoutType: 'content',
            slots: {},
          },
        ],
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).toContain(`narration: ${narration.length} characters set`)
    expect(out.text).toContain(
      'narration: none set — the app narrates this slide’s own content aloud instead',
    )
    // The control: the transcript text itself must be absent, from both the
    // prose and the structured data.
    expect(out.text).not.toContain(narration)
    expect(JSON.stringify(out.data)).not.toContain(narration)
    expect(out.data).toMatchObject({
      slides: [
        expect.objectContaining({
          id: 'slide-1',
          hasNarration: true,
          narrationLength: narration.length,
        }),
        expect.objectContaining({
          id: 'slide-2',
          hasNarration: false,
          narrationLength: 0,
        }),
      ],
    })
  })

  it('reports a slide’s author-named slots and manual-edit status, from the layout’s declared boxes', async () => {
    // MUST-FIX: derived from the deck's TEMPLATE (nyu-elegant's real
    // big-number layout: figure/label/caption, verified by hand against
    // server/config/templates/nyu-elegant.json), not from the slide's own
    // filled `slots` map — a box the layout declares but nothing has
    // filled yet must still be named.
    const call = fakeCall({
      'deck.get': {
        ...view,
        template: nyuElegant,
        slides: [
          // No `slots` entry for figure/label at all — an unfilled box must
          // still be reported, which the old slide.slots-derived version
          // could never do.
          { id: 'slide-1', index: 0, layoutType: 'big-number' },
          {
            id: 'slide-2',
            index: 1,
            layoutType: 'content',
            manuallyEdited: true,
          },
        ],
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    // "caption" is one of this surface's writable fields, so it is not
    // listed as an "other box" even though it is in `slots` too.
    expect(out.text).toContain(
      'other boxes on this layout, not writable from here: figure, label',
    )
    expect(out.text).not.toContain('figure, label, caption')
    expect(out.text).toContain('manually edited: yes')
    expect(out.data).toMatchObject({
      slides: [
        expect.objectContaining({
          id: 'slide-1',
          otherSlots: ['figure', 'label'],
        }),
        expect.objectContaining({
          id: 'slide-2',
          manuallyEdited: true,
          otherSlots: [],
        }),
      ],
    })
  })

  it('does not report a slot left over from a layout the slide is no longer on', async () => {
    // MUST-FIX: the OLD slide.slots-derived version would report this —
    // `figure` is stale data from before the slide switched to `content`,
    // not a box `content` actually has.
    const call = fakeCall({
      'deck.get': {
        ...view,
        template: nyuElegant,
        slides: [
          {
            id: 'slide-1',
            index: 0,
            layoutType: 'content',
            slots: { figure: { kind: 'text', value: '42%' } },
          },
        ],
      },
    })
    const out = await readLecture.run(call, { lectureId: 'deck-1' })

    expect(out.text).not.toContain('figure')
    expect(out.data).toMatchObject({
      slides: [expect.objectContaining({ id: 'slide-1', otherSlots: [] })],
    })
  })
})

describe('set_lecture_settings', () => {
  it('applies only the field passed, dispatching nothing for the rest', async () => {
    const call = fakeCall({
      'deck.setLanguage': { ...deck, language: 'es' },
    })
    const out = await setLectureSettings.run(call, {
      lectureId: 'deck-1',
      language: 'es',
    })

    expect(call.calls).toEqual([
      ['deck.setLanguage', { deckId: 'deck-1', language: 'es' }],
    ])
    expect(out.text).toContain('set language to "es"')
    expect(out.data).toMatchObject({
      language: 'es',
      generationFreedom: null,
      ttsVoice: null,
    })
  })

  it('applies all three fields when all three are passed, dispatching exactly those calls', async () => {
    const call = fakeCall({
      'deck.setLanguage': { ...deck, language: 'fr' },
      'deck.setGenerationFreedom': {
        ...deck,
        language: 'fr',
        generationFreedom: 1,
      },
      'deck.setTtsVoice': {
        ...deck,
        language: 'fr',
        generationFreedom: 1,
        ttsVoice: 'leo',
      },
    })
    const out = await setLectureSettings.run(call, {
      lectureId: 'deck-1',
      language: 'fr',
      generationFreedom: 1,
      ttsVoice: 'leo',
    })

    expect(call.calls).toEqual([
      ['deck.setLanguage', { deckId: 'deck-1', language: 'fr' }],
      ['deck.setGenerationFreedom', { deckId: 'deck-1', freedom: 1 }],
      ['deck.setTtsVoice', { deckId: 'deck-1', voice: 'leo' }],
    ])
    expect(out.text).toContain(
      'set language to "fr", AI freedom to 1, narration voice to "leo"',
    )
    expect(out.data).toMatchObject({
      language: 'fr',
      generationFreedom: 1,
      ttsVoice: 'leo',
    })
  })

  it('dispatches nothing and says so when no fields are passed', async () => {
    const call = fakeCall({})
    const out = await setLectureSettings.run(call, { lectureId: 'deck-1' })

    expect(call.calls).toEqual([])
    expect(out.text).toContain('nothing changed')
    // MUST-FIX: the no-op payload must match the success payload's shape —
    // it used to carry a `changed` key the success path never had.
    expect(out.data).toEqual({
      id: 'deck-1',
      url: null,
      language: null,
      generationFreedom: null,
      ttsVoice: null,
    })
  })

  it('accepts null to clear a field back to inheriting the project’s', async () => {
    const call = fakeCall({
      'deck.setLanguage': { ...deck, language: undefined },
    })
    const out = await setLectureSettings.run(call, {
      lectureId: 'deck-1',
      language: null,
    })

    expect(call.calls).toEqual([
      ['deck.setLanguage', { deckId: 'deck-1', language: null }],
    ])
    expect(out.text).toContain('set language to inherit the project’s value')
  })

  it('stops at the first failed setting and reports what already landed, in the established wording', async () => {
    // Language succeeds, AI freedom fails — the model must be told the
    // language change already landed and only the freedom needs retrying,
    // not the established describeErrorForAgent "Nothing was changed" text.
    const call = (async (action: string) => {
      if (action === 'deck.setLanguage') return { ...deck, language: 'es' }
      if (action === 'deck.setGenerationFreedom') {
        throw new Error('setGenerationFreedom exploded')
      }
      throw new Error(`unexpected action ${action}`)
    }) as ActionCaller

    const out = await setLectureSettings.run(call, {
      lectureId: 'deck-1',
      language: 'es',
      generationFreedom: 1,
    })

    expect(out.isError).toBe(true)
    // Byte-identical partial-failure convention as the batch tools in
    // slides.ts — this is the same partialFailureText helper.
    expect(out.text).toBe(
      'Set language to "es" on lecture deck-1. Entry 1 failed: Something ' +
        'went wrong on the server and the operation did not run. (code: ' +
        'internal_error, retryable: true). No entries after entry 1 remain. ' +
        'Retry entry 1 — not the whole batch. The settings already applied ' +
        'do not need to be repeated.',
    )
    expect(out.text).not.toContain('Nothing was changed')
    expect(out.data).toMatchObject({ language: 'es', failedIndex: 1 })
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

  it('tells the caller add_slides is what fills it, and not to call it done yet', async () => {
    // MCP-1: the failure this guards against is a client declaring the deck
    // "ready" right after create_lecture, having never called add_slides.
    const call = fakeCall({ 'deck.create': deck })
    const out = await createLecture.run(call, {
      projectId: 'proj-1',
      title: 'Week 4 — Recursion',
    })
    // Points at the batch tool for building the deck, not just at add_slide.
    expect(out.text).toContain('call add_slides')
    expect(out.text).toMatch(/do not tell.*ready/i)
  })

  it('names an untitled lecture the way the app displays it', async () => {
    const call = fakeCall({ 'deck.create': { ...deck, title: '' } })
    const out = await createLecture.run(call, {
      projectId: 'proj-1',
      title: '',
    })
    expect(out.text).toContain('Untitled lecture')
  })

  it('is not idempotent — every call makes a new lecture', () => {
    expect(createLecture.idempotent).toBe(false)
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

  it('says what a non-empty title actually does, rather than claiming nothing else changes', () => {
    // deck.rename sets titleLocked whenever the title is non-empty
    // (server/src/actions/deck.ts), permanently disabling the app's own
    // auto-titling — "Nothing else about it changes" was false.
    expect(renameLecture.description).not.toContain(
      'Nothing else about it changes',
    )
    expect(renameLecture.description).toMatch(/lock/i)
    expect(renameLecture.description).toMatch(/auto-titl/i)
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

  it('reports zero slides and that none were created, on a slide-less lecture', async () => {
    // MCP-1: the tool an instructor's assistant reached for after set_notes,
    // expecting slides to now exist. They do not, and the reply must say so
    // at the exact turn the caller might otherwise declare victory.
    const call = fakeCall({
      'deck.setSeedNotes': { ...deck, slideOrder: [] },
    })
    const out = await setLectureNotes.run(call, {
      lectureId: 'deck-1',
      notes: 'Chapter 6.',
    })
    expect(out.text).toContain('0 slides')
    expect(out.text).toContain('no slides were created')
  })

  it('reads the live slide count off the deck rather than hardcoding it', async () => {
    // Same tool, a lecture that already has slides — the count must be read,
    // not a constant that happens to satisfy the zero-slide case above.
    const call = fakeCall({
      'deck.setSeedNotes': {
        ...deck,
        slideOrder: ['slide-1', 'slide-2', 'slide-3'],
      },
    })
    const out = await setLectureNotes.run(call, {
      lectureId: 'deck-1',
      notes: 'Chapter 6.',
    })
    expect(out.text).toContain('3 slides')
    expect(out.text).toContain('no slides were created')
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
        template: emptyTemplate,
        canEdit: true,
        project: { id: 'proj-1', title: 'CS 101' },
        projectGenerationFreedom: 3,
      },
      'deck.create': deck,
      'deck.rename': deck,
      'deck.setSeedNotes': deck,
      'deck.setLanguage': deck,
      'deck.setGenerationFreedom': deck,
      'deck.setTtsVoice': deck,
    })
    const inputs = [
      [findLectures, {}],
      [readLecture, { lectureId: 'deck-1' }],
      [createLecture, { projectId: 'proj-1', title: 'x' }],
      [renameLecture, { lectureId: 'deck-1', title: 'x' }],
      [setLectureNotes, { lectureId: 'deck-1', notes: 'x' }],
      [setLectureSettings, { lectureId: 'deck-1', language: 'es' }],
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
