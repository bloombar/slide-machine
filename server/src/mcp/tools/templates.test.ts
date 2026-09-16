/**
 * Unit tests for the design tools (docs/MCP.md §4.1).
 */
import { describe, expect, it } from 'vitest'
import type { ActionCaller } from '../tool'
import { listTemplates, restyleLecture } from './templates'
import { listBuiltinTemplates } from '../../templates/builtin'

/** The real nyu-elegant template — see slides.test.ts for why the detail
 * view must be checked against a real template file rather than a fixture
 * invented to match the assertion. */
const nyuElegant = listBuiltinTemplates().find(t => t.id === 'nyu-elegant')!

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

describe('list_templates', () => {
  it('names each design and the layouts it offers', async () => {
    // The layout names are the point: they are the only valid values for the
    // layoutType argument of add_slide and edit_slides.
    const call = fakeCall({
      'template.list': [
        {
          id: 'classic',
          name: 'Classic',
          layouts: [{ type: 'title' }, { type: 'content' }],
        },
      ],
    })
    const out = await listTemplates.run(call, {})

    expect(call.calls).toEqual([['template.list', {}]])
    expect(out.text).toContain('template id: classic')
    expect(out.text).toContain('title, content')
    expect(out.data).toEqual({
      templates: [
        { id: 'classic', name: 'Classic', layouts: ['title', 'content'] },
      ],
    })
  })

  it('reports an account with no templates at all', async () => {
    const call = fakeCall({ 'template.list': [] })
    const out = await listTemplates.run(call, {})
    expect(out.text).toContain('0 templates available')
  })

  it('counts a single template in the singular', async () => {
    const call = fakeCall({
      'template.list': [{ id: 'classic', name: 'Classic', layouts: [] }],
    })
    const out = await listTemplates.run(call, {})
    expect(out.text).toContain('1 template available')
  })

  it('omits whiteboard from the short list, and does not dump budgets without a templateId', async () => {
    const call = fakeCall({ 'template.list': [nyuElegant] })
    const out = await listTemplates.run(call, {})

    expect(out.text).not.toContain('whiteboard')
    expect(out.data).toEqual({
      templates: [
        {
          id: 'nyu-elegant',
          name: 'NYU Elegant',
          layouts: nyuElegant.layouts
            .map(l => l.type)
            .filter(t => t !== 'whiteboard'),
        },
      ],
    })
    // Told where to get the budgets, not handed them unasked.
    expect(out.text).toContain('templateId')
    expect(out.text).not.toContain('maxChars')
  })

  it('reports every layout’s boxes and real character budgets when given a templateId', async () => {
    const call = fakeCall({ 'template.list': [nyuElegant] })
    const out = await listTemplates.run(call, { templateId: 'nyu-elegant' })

    // Verified against server/config/templates/nyu-elegant.json: "content"
    // declares title maxChars 44 and body maxChars 300.
    expect(out.text).toContain('layoutType: "content"')
    expect(out.text).toContain('title (text, ≤44 chars)')
    expect(out.text).toContain('body (text, ≤300 chars)')
    // "list" declares bullets maxItems 5, maxChars 70.
    expect(out.text).toContain('bullets (bullets, ≤5 items, ≤70 chars)')
    expect(out.text).not.toContain('"whiteboard"')

    const content = out.data as {
      template: { layouts: { type: string; slots: unknown[] }[] }
    }
    const contentLayout = content.template.layouts.find(
      l => l.type === 'content',
    )
    expect(contentLayout?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'title', maxChars: 44 }),
        expect.objectContaining({ name: 'body', maxChars: 300 }),
      ]),
    )
  })

  it('refuses an unknown templateId rather than silently listing something else', async () => {
    const call = fakeCall({ 'template.list': [nyuElegant] })
    const out = await listTemplates.run(call, { templateId: 'not-a-template' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('No template with id "not-a-template"')
  })
})

describe('restyle_lecture', () => {
  it('switches one lecture and reports how many slides were remapped', async () => {
    const call = fakeCall({
      'deck.switchTemplate': {
        id: 'deck-1',
        templateId: 'nyu-elegant',
        slideOrder: ['s1', 's2', 's3'],
      },
    })
    const out = await restyleLecture.run(call, {
      lectureId: 'deck-1',
      templateId: 'nyu-elegant',
    })

    expect(call.calls).toEqual([
      ['deck.switchTemplate', { deckId: 'deck-1', templateId: 'nyu-elegant' }],
    ])
    expect(out.text).toContain('3 slides were remapped')
  })

  it('reads correctly on an empty deck', async () => {
    const call = fakeCall({
      'deck.switchTemplate': {
        id: 'deck-1',
        templateId: 'nyu-elegant',
        slideOrder: [],
      },
    })
    const out = await restyleLecture.run(call, {
      lectureId: 'deck-1',
      templateId: 'nyu-elegant',
    })
    expect(out.text).toContain('It has no slides to remap.')
    expect(out.text).not.toContain('0 slides were remapped')
  })

  it('mis-pluralises neither the slide count nor the verb at one slide', async () => {
    const call = fakeCall({
      'deck.switchTemplate': {
        id: 'deck-1',
        templateId: 'nyu-elegant',
        slideOrder: ['s1'],
      },
    })
    const out = await restyleLecture.run(call, {
      lectureId: 'deck-1',
      templateId: 'nyu-elegant',
    })
    expect(out.text).toContain(
      'Its 1 slide was remapped to that design’s layouts.',
    )
    expect(out.text).not.toContain('1 slides')
    expect(out.text).not.toContain('slide were remapped')
  })
})
