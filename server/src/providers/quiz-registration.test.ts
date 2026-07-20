/**
 * Verifies the quiz providers self-register under the quizGeneration
 * capability and are resolvable by name through the registry, so a
 * QUIZ_PROVIDER config value selects the right adapter. Uses fresh module
 * state per case so each selector resolves its own factory.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { QuizGenerationProvider } from '@slide-machine/shared'

const envFor = (quizProvider: string) => ({
  env: {
    TRANSCRIPTION_PROVIDER: 'mock',
    GENERATION_PROVIDER: 'mock',
    QUIZ_PROVIDER: quizProvider,
    IMAGE_GEN_PROVIDER: 'mock',
    TTS_PROVIDER: 'mock',
  },
})

/** Loads the registry and both quiz adapters against a chosen selector. */
const resolveQuizProvider = async (
  quizProvider: string,
): Promise<QuizGenerationProvider> => {
  vi.resetModules()
  vi.doMock('../config/env', () => envFor(quizProvider))
  const { registry } = await import('./registry')
  await import('./mock-quiz')
  await import('./gemini-quiz')
  return registry.get<QuizGenerationProvider>('quizGeneration')
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../config/env')
})

describe('quiz provider registration', () => {
  it('resolves the Gemini adapter when QUIZ_PROVIDER=gemini', async () => {
    expect((await resolveQuizProvider('gemini')).name).toBe('gemini')
  })

  it('resolves the mock adapter when QUIZ_PROVIDER=mock', async () => {
    expect((await resolveQuizProvider('mock')).name).toBe('mock')
  })
})
