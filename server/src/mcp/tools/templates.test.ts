/**
 * Unit tests for the design tools (docs/MCP.md §4.1).
 */
import { describe, expect, it } from 'vitest'
import type { ActionCaller } from '../tool'
import { listTemplates, restyleLecture } from './templates'

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
})
