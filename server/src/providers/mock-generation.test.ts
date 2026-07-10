/**
 * Unit tests for the mock generation provider's documented heuristics
 * and the layout-fallback rule (GEN-6).
 */
import { describe, it, expect } from 'vitest'
import { MockGenerationProvider } from './mock-generation'
import { BUILTIN_TEMPLATES, layoutDescriptors } from '../templates/builtin'
import type { LayoutDescriptor } from '@slide-machine/shared'

const provider = new MockGenerationProvider()
const descriptors = layoutDescriptors(BUILTIN_TEMPLATES[0]!)

const gen = (
  phrase: string,
  rollingContext: string[] = [],
  lds: LayoutDescriptor[] = descriptors,
) =>
  provider.generateSlideContent({
    phrase,
    rollingContext,
    layoutDescriptors: lds,
  })

describe('MockGenerationProvider', () => {
  it('makes a title slide from a short opening phrase', async () => {
    const r = await gen('Photosynthesis basics')
    expect(r).toMatchObject({ action: 'new', layoutType: 'title' })
    expect(r.slots.title).toBe('Photosynthesis Basics')
  })

  it('makes a list slide from comma-separated points', async () => {
    const r = await gen('Plants need sunlight, water, carbon dioxide')
    expect(r).toMatchObject({ action: 'new', layoutType: 'list' })
    expect(r.slots.bullets).toHaveLength(3)
  })

  it('makes a quote slide from a question', async () => {
    const r = await gen('But what happens at night?')
    expect(r).toMatchObject({ action: 'new', layoutType: 'quote' })
  })

  it('updates the current slide on a continuation phrase with context', async () => {
    const r = await gen('Also chlorophyll absorbs light', [
      'previous slide text',
    ])
    expect(r.action).toBe('update')
    expect(r.slots.bullets).toEqual(['chlorophyll absorbs light'])
  })

  it('returns none for empty speech', async () => {
    expect((await gen('   ')).action).toBe('none')
  })

  it('falls back to an available layout when the wanted one is missing (GEN-6)', async () => {
    const onlyContent = descriptors.filter(d => d.type === 'content')
    const r = await gen('But what happens at night?', [], onlyContent)
    expect(r.layoutType).toBe('content')
  })
})
