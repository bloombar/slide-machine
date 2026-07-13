/**
 * Unit tests for the mock generation provider's documented heuristics
 * and the layout-fallback rule (GEN-6).
 */
import { describe, it, expect } from 'vitest'
import { MockGenerationProvider } from './mock-generation'
import { listBuiltinTemplates, layoutDescriptors } from '../templates/builtin'
import type { LayoutDescriptor } from '@slide-machine/shared'
import { VOICE_COMMAND_DESCRIPTORS } from '@slide-machine/shared'

const provider = new MockGenerationProvider()
const descriptors = layoutDescriptors(listBuiltinTemplates()[0]!)

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
    expect(r.updateMode).toBe('delta')
    expect(r.slots.bullets).toEqual(['chlorophyll absorbs light'])
  })

  it('refits to a list when a continuation enumerates and refit is allowed', async () => {
    const r = await provider.generateSlideContent({
      phrase: 'Also it contains cholesterol, embedded proteins, glycolipids',
      rollingContext: ['previous slide text'],
      layoutDescriptors: descriptors,
      allowLayoutRefit: true,
      currentSlide: {
        layoutType: 'content',
        bulletCount: 0,
        bodyWords: 5,
        content: {
          title: 'Cell Membranes',
          body: 'The membrane is a bilayer',
        },
      },
    })
    expect(r).toMatchObject({
      action: 'update',
      updateMode: 'refit',
      layoutType: 'list',
    })
    // The complete slide: existing title kept, body carried into bullets
    expect(r.slots.title).toBe('Cell Membranes')
    expect(r.slots.bullets).toEqual([
      'The membrane is a bilayer',
      'it contains cholesterol',
      'embedded proteins',
      'glycolipids',
    ])
  })

  it('stays a delta update when refit is not allowed', async () => {
    const r = await gen(
      'Also it contains cholesterol, embedded proteins, glycolipids',
      ['previous slide text'],
    )
    expect(r.action).toBe('update')
    expect(r.updateMode).toBe('delta')
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

describe('MockGenerationProvider voice-command intent', () => {
  const withCommands = (phrase: string) =>
    provider.generateSlideContent({
      phrase,
      rollingContext: [],
      layoutDescriptors: descriptors,
      voiceCommands: VOICE_COMMAND_DESCRIPTORS,
    })

  it('maps "please …" phrases to offered commands', async () => {
    expect(await withCommands('Please next slide')).toMatchObject({
      action: 'command',
      command: 'next',
    })
    expect(await withCommands('please, go back')).toMatchObject({
      action: 'command',
      command: 'previous',
    })
    expect(await withCommands('Please pause')).toMatchObject({
      action: 'command',
      command: 'pause',
    })
    expect(await withCommands('Please new slide.')).toMatchObject({
      action: 'command',
      command: 'newSlide',
    })
  })

  it('treats the same phrase as lecture content when commands are not offered', async () => {
    const r = await gen('Please next slide')
    expect(r.action).toBe('new')
  })

  it('never returns a command outside the offered set', async () => {
    const r = await provider.generateSlideContent({
      phrase: 'Please next slide',
      rollingContext: [],
      layoutDescriptors: descriptors,
      voiceCommands: VOICE_COMMAND_DESCRIPTORS.filter(c => c.id === 'pause'),
    })
    expect(r.action).not.toBe('command')
  })

  it('leaves non-command "please" phrases to the content heuristics', async () => {
    const r = await withCommands('Please remember the midterm is Tuesday')
    expect(r.action).toBe('new')
  })
})

describe('MockGenerationProvider two-column heuristic', () => {
  it('gives long descriptive sentences a two-column layout with image keywords', async () => {
    const r = await gen(
      'The mitochondria is the powerhouse of the cell as everyone knows',
    )
    expect(r).toMatchObject({ action: 'new', layoutType: 'two-column' })
    expect(r.imageGuidance?.keywords.length).toBeGreaterThan(0)
  })
})
