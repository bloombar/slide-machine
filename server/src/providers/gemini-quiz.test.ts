/**
 * Unit tests for the Gemini quiz adapter against a stubbed fetch: prompt
 * assembly from slide text, response parsing/validation, dropping questions
 * with an out-of-range correctIndex, and failure modes (missing key, no
 * content, quota/overload, malformed output). The live API is never called.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { QuizGenerationRequest } from '@slide-machine/shared'
const testEnv = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key' as string | undefined,
  GEMINI_MODEL: 'gemini-test-model',
  GEMINI_TIMEOUT_MS: 5000,
  GENERATION_LOG_PROMPTS: false as boolean,
  PROMPTS_DIR: new URL('../../../config/prompts', import.meta.url).pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { GeminiQuizProvider } from './gemini-quiz'
import { GenerationUnavailableError } from './errors'
import { resetQuizPromptCache } from './quiz-prompt'

const provider = new GeminiQuizProvider()

const req = (
  over: Partial<QuizGenerationRequest> = {},
): QuizGenerationRequest => ({
  slides: [
    { title: 'Photosynthesis', bullets: ['Occurs in chloroplasts'] },
    { title: 'Respiration', body: 'Releases energy' },
  ],
  ...over,
})

const reply = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }),
})

const validQuiz = {
  title: 'Photosynthesis Quiz',
  description: 'Exit ticket',
  questions: [
    {
      question: 'Where does it occur?',
      choices: ['Chloroplasts', 'Nucleus'],
      correctIndex: 0,
      points: 1,
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  testEnv.GEMINI_API_KEY = 'test-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetQuizPromptCache()
})

afterEach(() => vi.unstubAllGlobals())

describe('GeminiQuizProvider', () => {
  it('builds the prompt from slide text and the requested count', async () => {
    fetchMock.mockResolvedValue(reply(validQuiz))
    await provider.generateQuiz(req({ questionCount: 4 }))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain(':generateContent')
    const body = JSON.parse(String(init.body))
    const prompt = body.contents[0].parts[0].text as string
    expect(prompt).toContain('EXACTLY 4 questions')
    expect(prompt).toContain('Photosynthesis')
    expect(prompt).toContain('Occurs in chloroplasts')
    // JSON output requested via mime type
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('parses and returns a valid quiz definition', async () => {
    fetchMock.mockResolvedValue(reply(validQuiz))
    const quiz = await provider.generateQuiz(req())
    expect(quiz.title).toBe('Photosynthesis Quiz')
    expect(quiz.description).toBe('Exit ticket')
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0]!.correctIndex).toBe(0)
  })

  it('drops questions whose correctIndex points outside the choices', async () => {
    fetchMock.mockResolvedValue(
      reply({
        title: 'Q',
        questions: [
          { question: 'good', choices: ['a', 'b'], correctIndex: 1 },
          { question: 'bad', choices: ['a', 'b'], correctIndex: 9 },
        ],
      }),
    )
    const quiz = await provider.generateQuiz(req())
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0]!.question).toBe('good')
  })

  it('defaults the question count when none is given', async () => {
    fetchMock.mockResolvedValue(reply(validQuiz))
    await provider.generateQuiz(req())
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('EXACTLY 5 questions')
  })

  it('throws without an API key', async () => {
    testEnv.GEMINI_API_KEY = undefined
    await expect(provider.generateQuiz(req())).rejects.toThrow(/GEMINI_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws before calling the API when there is no slide text', async () => {
    await expect(
      provider.generateQuiz(req({ slides: [{ title: ' ' }] })),
    ).rejects.toThrow(/No slide text/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps quota exhaustion (429) to a non-retryable unavailable error', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'quota' }, 429))
    await expect(provider.generateQuiz(req())).rejects.toMatchObject({
      constructor: GenerationUnavailableError,
      retryable: false,
    })
  })

  it('maps overload (503) to a retryable unavailable error', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'busy' }, 503))
    await expect(provider.generateQuiz(req())).rejects.toMatchObject({
      retryable: true,
    })
  })

  it('throws on other non-2xx responses', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'bad' }, 400))
    await expect(provider.generateQuiz(req())).rejects.toThrow(/failed \(400\)/)
  })

  it('still throws when the error body itself cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => {
        throw new Error('body unreadable')
      },
    })
    await expect(provider.generateQuiz(req())).rejects.toThrow(/failed \(400\)/)
  })

  it('throws on unparseable JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not json',
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not json{' }] } }],
      }),
    })
    await expect(provider.generateQuiz(req())).rejects.toThrow(/unparseable/)
  })

  it('throws when the model returns a malformed quiz', async () => {
    fetchMock.mockResolvedValue(reply({ title: 'Q', questions: [] }))
    await expect(provider.generateQuiz(req())).rejects.toThrow(/malformed quiz/)
  })

  it('throws when no candidate text comes back, logging the placeholder', async () => {
    testEnv.GENERATION_LOG_PROMPTS = true
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({ candidates: [] }),
    })
    try {
      await expect(provider.generateQuiz(req())).rejects.toThrow(
        /no candidate text/,
      )
      expect(log.mock.calls.map(c => String(c[0])).join('\n')).toContain(
        '(no candidate text)',
      )
    } finally {
      log.mockRestore()
      testEnv.GENERATION_LOG_PROMPTS = false
    }
  })

  it('throws when every question has an out-of-range correctIndex', async () => {
    fetchMock.mockResolvedValue(
      reply({
        title: 'Q',
        questions: [{ question: 'bad', choices: ['a', 'b'], correctIndex: 9 }],
      }),
    )
    await expect(provider.generateQuiz(req())).rejects.toThrow(
      /no valid questions/,
    )
  })

  it('logs the prompt and response when GENERATION_LOG_PROMPTS is on', async () => {
    testEnv.GENERATION_LOG_PROMPTS = true
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(reply(validQuiz))
    try {
      await provider.generateQuiz(req())
      const logged = log.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toContain('QUIZ PROMPT')
      expect(logged).toContain('QUIZ RESPONSE')
    } finally {
      log.mockRestore()
      testEnv.GENERATION_LOG_PROMPTS = false
    }
  })
})
