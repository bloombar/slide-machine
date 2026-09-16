/**
 * Unit tests for the slide tools (docs/MCP.md §4.1).
 *
 * The ordering assertions here are the substance. `edit_slides` applies a
 * layout switch before content because switching remaps a slide's slots — do
 * it the other way round and the content lands in boxes the new layout does
 * not have. That is invisible in the types and would be a silent data loss.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ActionCaller } from '../tool'
import { addSlide, addSlides, editSlides, reorderSlides } from './slides'

/** The lecture the link-building read answers with. `PUBLIC_BASE_URL` is set
 * for the whole suite in vitest.config.ts, so the URLs below are the real
 * ones a tool would hand an assistant. */
const deckView = { deck: { permalinkSlug: 'week-4-recursion' } }

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

describe('edit_slides', () => {
  it('applies several edits in one call, in the order given', async () => {
    const call = fakeCall({
      'slide.editContent': { deckId: 'deck-1' },
      'deck.get': deckView,
    })
    const out = await editSlides.run(call, {
      edits: [
        { slideId: 'slide-1', title: 'Recursion' },
        { slideId: 'slide-2', bullets: ['base case'] },
      ],
    })

    expect(call.calls).toEqual([
      ['slide.editContent', { slideId: 'slide-1', title: 'Recursion' }],
      ['slide.editContent', { slideId: 'slide-2', bullets: ['base case'] }],
      // One lecture read for the link, after the batch — not one per edit.
      ['deck.get', { deckId: 'deck-1' }],
    ])
    expect(out.text).toContain('2 slides')
    expect(out.data).toEqual({
      edited: ['slide-1', 'slide-2'],
      url: 'http://localhost:3000/d/week-4-recursion?slide=slide-1',
    })
  })

  it('links to the first slide of the batch, which is where a reader starts', async () => {
    const call = fakeCall({
      'slide.editContent': { deckId: 'deck-1' },
      'deck.get': deckView,
    })
    const out = await editSlides.run(call, {
      edits: [
        { slideId: 'slide-7', title: 'a' },
        { slideId: 'slide-8', title: 'b' },
      ],
    })

    expect(out.text).toContain(
      'http://localhost:3000/d/week-4-recursion?slide=slide-7',
    )
  })

  it('still reports the edit when the lecture cannot be read back', async () => {
    // The link is an afterword to work that already happened: losing it must
    // not turn a successful edit into a failed tool call.
    const call = (async (action: string) => {
      if (action === 'deck.get') throw new Error('nope')
      return { deckId: 'deck-1' }
    }) as ActionCaller
    const out = await editSlides.run(call, {
      edits: [{ slideId: 'slide-1', title: 'x' }],
    })

    expect(out.text).toContain('Edited 1 slide: slide-1.')
    expect(out.text).not.toContain('undefined')
    expect(out.data).toEqual({ edited: ['slide-1'], url: null })
  })

  it('switches layout before writing content, so content lands in the new slots', async () => {
    const call = fakeCall({ 'slide.setLayout': {}, 'slide.editContent': {} })
    await editSlides.run(call, {
      edits: [{ slideId: 'slide-1', layoutType: 'quote', title: 'Recursion' }],
    })

    expect(call.calls.map(([action]) => action)).toEqual([
      'slide.setLayout',
      'slide.editContent',
    ])
    // The layout name must not ride along into the content edit, which does
    // not accept it.
    expect(call.calls[1]?.[1]).toEqual({
      slideId: 'slide-1',
      title: 'Recursion',
    })
  })

  it('does not write content when only the layout was asked for', async () => {
    const call = fakeCall({ 'slide.setLayout': {} })
    await editSlides.run(call, {
      edits: [{ slideId: 'slide-1', layoutType: 'quote' }],
    })
    expect(call.calls.map(([action]) => action)).toEqual(['slide.setLayout'])
  })

  it('counts a single edit in the singular', async () => {
    const call = fakeCall({ 'slide.editContent': {} })
    const out = await editSlides.run(call, {
      edits: [{ slideId: 'slide-1', title: 'x' }],
    })
    expect(out.text).toContain('1 slide:')
  })

  it('stops at the first failure and reports what happened, not a bare error', async () => {
    // A batch of three edits where the third fails: the model must be told
    // the first two really landed, exactly which entry failed and why, and
    // that the rest were never attempted — so it retries only entry 2.
    const calls: [string, unknown][] = []
    let editCount = 0
    const call = (async (action: string, input: unknown) => {
      calls.push([action, input])
      if (action === 'slide.editContent') {
        editCount++
        if (editCount === 3) throw new Error('editContent exploded')
        return { deckId: 'deck-1' }
      }
      throw new Error(`unexpected action ${action}`)
    }) as ActionCaller

    const out = await editSlides.run(call, {
      edits: [
        { slideId: 'slide-1', title: 'a' },
        { slideId: 'slide-2', title: 'b' },
        { slideId: 'slide-3', title: 'c' },
      ],
    })

    expect(out.isError).toBe(true)
    expect(out.text).toContain('Edited 2 of 3 slides: slide-1, slide-2.')
    expect(out.text).toContain('Entry at index 2 failed')
    expect(out.text).toContain('(code: internal_error, retryable: true)')
    expect(out.text).toContain('entry 2 was NOT attempted')
    expect(out.text).toContain('not the whole batch')
    expect(out.text).not.toContain('slide-3')
    expect(out.data).toEqual({
      edited: ['slide-1', 'slide-2'],
      failedIndex: 2,
      url: null,
    })
    // The two edits that succeeded really were dispatched — a model that
    // retries the whole batch would repeat calls that already happened.
    expect(
      calls.filter(([action]) => action === 'slide.editContent'),
    ).toHaveLength(3)
    expect(calls[0]).toEqual([
      'slide.editContent',
      { slideId: 'slide-1', title: 'a' },
    ])
    expect(calls[1]).toEqual([
      'slide.editContent',
      { slideId: 'slide-2', title: 'b' },
    ])
  })
})

describe('add_slide', () => {
  it('appends a slide and fills it in the same call', async () => {
    const call = fakeCall({
      'slide.add': { id: 'slide-3', index: 2, layoutType: 'content' },
      'slide.editContent': { id: 'slide-3', index: 2, layoutType: 'content' },
      'deck.get': deckView,
    })
    const out = await addSlide.run(call, {
      lectureId: 'deck-1',
      title: 'Trees',
      bullets: ['nodes', 'edges'],
    })

    expect(call.calls).toEqual([
      ['slide.add', { deckId: 'deck-1' }],
      [
        'slide.editContent',
        { slideId: 'slide-3', title: 'Trees', bullets: ['nodes', 'edges'] },
      ],
      ['deck.get', { deckId: 'deck-1' }],
    ])
    // The position is reported as a person counts, not as the array indexes.
    expect(out.text).toContain('as slide 3')
    // The link opens the slide that was just added, not the lecture's first.
    expect(out.text).toContain(
      'http://localhost:3000/d/week-4-recursion?slide=slide-3',
    )
  })

  it('passes a named layout through to the action that validates it', async () => {
    const call = fakeCall({
      'slide.add': { id: 'slide-3', index: 2, layoutType: 'quote' },
    })
    await addSlide.run(call, { lectureId: 'deck-1', layoutType: 'quote' })
    expect(call.calls[0]).toEqual([
      'slide.add',
      { deckId: 'deck-1', layoutType: 'quote' },
    ])
  })

  it('steers the caller toward the next call rather than declaring the lecture done', async () => {
    // MCP-1: add_slide is the only way a slide comes to exist; the result
    // text must say to call it again, not read as though one call finishes
    // a multi-slide lecture.
    const call = fakeCall({
      'slide.add': { id: 'slide-3', index: 2, layoutType: 'content' },
      'deck.get': deckView,
    })
    const out = await addSlide.run(call, { lectureId: 'deck-1' })
    // Matched as exact phrases, not a loose pattern: /call.*add_slide.*again/
    // matches "do NOT call add_slide again" just as happily, which is the
    // defect this test exists to catch.
    expect(out.text).toContain('call add_slide again for the next one')
    expect(out.text).toContain(
      'the lecture is not finished until every one of them exists',
    )
    expect(out.text).not.toMatch(
      /do not call add_slide|the app will (fill|add)/i,
    )
  })

  it('skips the content edit when there is no content to write', async () => {
    const call = fakeCall({
      'slide.add': { id: 'slide-3', index: 2, layoutType: 'content' },
      'deck.get': deckView,
    })
    const out = await addSlide.run(call, { lectureId: 'deck-1' })

    expect(call.calls.map(([action]) => action)).toEqual([
      'slide.add',
      'deck.get',
    ])
    expect(out.data).toMatchObject({ id: 'slide-3' })
  })

  it('accepts a caption in its input schema, the same as edit_slides already can', () => {
    // The schema is the part that matters: the SDK parses a call's arguments
    // against it before run() ever sees them, so a field missing from the
    // shape is stripped before this test's run()-based assertion below would
    // ever notice.
    const parsed = z.object(addSlide.input).parse({
      lectureId: 'deck-1',
      caption: 'Figure 1: a binary tree',
    })
    expect(parsed.caption).toBe('Figure 1: a binary tree')
  })

  it('writes a caption, the same as edit_slides already can', async () => {
    const call = fakeCall({
      'slide.add': { id: 'slide-3', index: 2, layoutType: 'picture' },
      'slide.editContent': { id: 'slide-3', index: 2, layoutType: 'picture' },
      'deck.get': deckView,
    })
    await addSlide.run(call, {
      lectureId: 'deck-1',
      layoutType: 'picture',
      caption: 'Figure 1: a binary tree',
    })

    expect(call.calls[1]).toEqual([
      'slide.editContent',
      { slideId: 'slide-3', caption: 'Figure 1: a binary tree' },
    ])
  })
})

describe('add_slides', () => {
  it('appends several slides in one call, in the order given, and reports the resulting count', async () => {
    // The lecture already has 4 slides, so the new ones land at indexes 4-6.
    const calls: [string, unknown][] = []
    let nextIndex = 4
    const call = (async (action: string, input: unknown) => {
      calls.push([action, input])
      if (action === 'slide.add') {
        const id = `slide-${nextIndex + 1}`
        const index = nextIndex
        nextIndex += 1
        return { id, deckId: 'deck-1', index, layoutType: 'content' }
      }
      if (action === 'slide.editContent') {
        const slideId = (input as { slideId: string }).slideId
        return {
          id: slideId,
          deckId: 'deck-1',
          index: nextIndex - 1,
          layoutType: 'content',
        }
      }
      if (action === 'deck.get') return deckView
      throw new Error(`unexpected action ${action}`)
    }) as ActionCaller

    const out = await addSlides.run(call, {
      lectureId: 'deck-1',
      slides: [{ title: 'Intro' }, { title: 'Trees' }, { title: 'Graphs' }],
    })

    expect(calls.map(([action]) => action)).toEqual([
      'slide.add',
      'slide.editContent',
      'slide.add',
      'slide.editContent',
      'slide.add',
      'slide.editContent',
      // One lecture read for the link, after the whole batch — not one per slide.
      'deck.get',
    ])
    expect(out.text).toContain('Added 3 slides')
    expect(out.text).toContain('now 7 slides')
    expect(out.data).toEqual({
      added: ['slide-5', 'slide-6', 'slide-7'],
      count: 7,
      url: 'http://localhost:3000/d/week-4-recursion?slide=slide-5',
    })
  })

  it('composes exactly add_slide’s actions, so the metering gate stays satisfied', () => {
    expect(addSlides.uses).toEqual([
      'slide.add',
      'slide.editContent',
      'deck.get',
    ])
  })

  it('stops at the first failure, reports what was created, and says the rest were not attempted', async () => {
    // Three slides, the third failing on its slide.add call. This is the
    // dangerous case: a model that retries the whole batch on a bare error
    // would create slide-1 and slide-2 a second time.
    const calls: [string, unknown][] = []
    let addCount = 0
    const call = (async (action: string, input: unknown) => {
      calls.push([action, input])
      if (action === 'slide.add') {
        addCount++
        if (addCount === 3) throw new Error('slide.add exploded')
        return {
          id: `slide-${addCount}`,
          deckId: 'deck-1',
          index: addCount - 1,
          layoutType: 'content',
        }
      }
      if (action === 'slide.editContent') {
        const slideId = (input as { slideId: string }).slideId
        return {
          id: slideId,
          deckId: 'deck-1',
          index: addCount - 1,
          layoutType: 'content',
        }
      }
      throw new Error(`unexpected action ${action}`)
    }) as ActionCaller

    const out = await addSlides.run(call, {
      lectureId: 'deck-1',
      slides: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
    })

    expect(out.isError).toBe(true)
    expect(out.text).toContain(
      'Added 2 of 3 slides to lecture deck-1 (now 2 slides): slide-1, slide-2.',
    )
    expect(out.text).toContain('Entry at index 2 failed')
    expect(out.text).toContain('(code: internal_error, retryable: true)')
    expect(out.text).toContain('entry 2 was NOT attempted')
    expect(out.text).toContain('not the whole batch')
    expect(out.text).not.toContain('slide-3')
    expect(out.data).toEqual({
      added: ['slide-1', 'slide-2'],
      count: 2,
      failedIndex: 2,
      url: null,
    })
    // The first two slides really were created — the calls happened.
    expect(calls.filter(([action]) => action === 'slide.add')).toHaveLength(3)
    expect(
      calls.filter(([action]) => action === 'slide.editContent'),
    ).toHaveLength(2)
    expect(calls[0]).toEqual(['slide.add', { deckId: 'deck-1' }])
    expect(calls[2]).toEqual(['slide.add', { deckId: 'deck-1' }])
  })
})

describe('reorder_slides', () => {
  it('sends the whole order through and confirms the count', async () => {
    const call = fakeCall({
      'deck.reorderSlides': {
        id: 'deck-1',
        permalinkSlug: 'week-4-recursion',
        slideOrder: ['slide-2', 'slide-1'],
      },
    })
    const out = await reorderSlides.run(call, {
      lectureId: 'deck-1',
      slideIds: ['slide-2', 'slide-1'],
    })

    // No second read for the link: reordering answers with the lecture, so
    // its address is already in hand.
    expect(call.calls).toEqual([
      [
        'deck.reorderSlides',
        { deckId: 'deck-1', slideOrder: ['slide-2', 'slide-1'] },
      ],
    ])
    expect(out.text).toContain('2 slides')
    expect(out.text).toContain('http://localhost:3000/d/week-4-recursion')
  })
})
