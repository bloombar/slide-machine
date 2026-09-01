/**
 * Unit tests for the slide tools (docs/MCP.md §4.1).
 *
 * The ordering assertions here are the substance. `edit_slides` applies a
 * layout switch before content because switching remaps a slide's slots — do
 * it the other way round and the content lands in boxes the new layout does
 * not have. That is invisible in the types and would be a silent data loss.
 */
import { describe, expect, it } from 'vitest'
import type { ActionCaller } from '../tool'
import { addSlide, editSlides, reorderSlides } from './slides'

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
