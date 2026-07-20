/**
 * Unit tests for the provider registry: config-driven resolution,
 * unregistered-name errors, and the unimplemented-provider stub.
 */
import { describe, it, expect } from 'vitest'
import {
  ProviderRegistry,
  unimplementedProvider,
  type ProviderSelectors,
} from './registry'
import type { GenerationProvider } from '@slide-machine/shared'

const selectors: ProviderSelectors = {
  transcription: 'google-cloud',
  diarization: 'mock',
  generation: 'fake-llm',
  quizGeneration: 'gemini',
  imageGeneration: 'gemini',
  tts: 'google-cloud',
}

describe('ProviderRegistry', () => {
  it('resolves the adapter selected by configuration', () => {
    const registry = new ProviderRegistry(selectors)
    const fake = { name: 'fake-llm', generateSlideContent: async () => ({}) }
    registry.register('generation', 'fake-llm', () => fake)
    registry.register('generation', 'other-llm', () => ({ name: 'other-llm' }))

    expect(registry.get<GenerationProvider>('generation')).toBe(fake)
  })

  it('throws a descriptive error when the configured adapter is not registered', () => {
    const registry = new ProviderRegistry(selectors)
    registry.register('generation', 'other-llm', () => ({ name: 'other-llm' }))

    expect(() => registry.get('generation')).toThrowError(
      /fake-llm.*generation.*other-llm/s,
    )
  })

  it('unimplemented stub exposes its name but throws on any method call', () => {
    const stub = unimplementedProvider(
      'generation',
      'gemini',
    ) as GenerationProvider
    expect(stub.name).toBe('gemini')
    expect(() =>
      stub.generateSlideContent({
        phrase: '',
        rollingContext: [],
        layoutDescriptors: [],
      }),
    ).toThrowError(/not implemented/)
  })
})
