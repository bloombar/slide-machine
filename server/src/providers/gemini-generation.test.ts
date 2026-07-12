/**
 * Unit tests for the Gemini adapter against a stubbed fetch: prompt
 * assembly (seed layers, layouts, seeded images), response parsing and
 * validation, layout/seeded-id drift correction, and failure modes.
 * The live API is never called from tests.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { SlideGenerationRequest } from '@slide-machine/shared'
const testEnv = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key' as string | undefined,
  GEMINI_MODEL: 'gemini-test-model',
  GEMINI_TIMEOUT_MS: 5000,
  GENERATION_LOG_PROMPTS: false as boolean,
  // The real externalized templates: tests assert their content
  PROMPTS_DIR: new URL('../../../config/prompts', import.meta.url).pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { GeminiGenerationProvider } from './gemini-generation'

const provider = new GeminiGenerationProvider()

const request = (
  overrides: Partial<SlideGenerationRequest> = {},
): SlideGenerationRequest => ({
  phrase: 'Photosynthesis converts light into chemical energy',
  rollingContext: ['Photosynthesis Basics — an overview'],
  seedContext: {
    project: 'PROJECT-SEED biology fundamentals',
    deck: 'DECK-SEED chloroplast structure today',
  },
  layoutDescriptors: [
    {
      type: 'content',
      label: 'Content',
      purpose: 'General slide',
      slots: ['title', 'body'],
      constraints: { maxBodyLength: 400 },
    },
    {
      type: 'list',
      label: 'Bullet list',
      purpose: '3-6 parallel points',
      slots: ['title', 'bullets'],
      constraints: { maxBullets: 6 },
    },
  ],
  seededImages: [
    {
      id: 'asset1',
      caption: 'Chloroplast micrograph',
      keywords: ['chloroplast'],
    },
  ],
  currentSlide: { layoutType: 'list', bulletCount: 5, bodyWords: 0 },
  ...overrides,
})

const geminiReply = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }),
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  testEnv.GEMINI_API_KEY = 'test-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GeminiGenerationProvider', () => {
  it('assembles the prompt from layers, layouts, and seeded images', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'Photosynthesis', body: 'Light to energy' },
      }),
    )
    await provider.generateSlideContent(request())

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain(':generateContent')
    const body = JSON.parse(String(init.body))
    const prompt = body.contents[0].parts[0].text as string
    // Both seed layers present, lecture layer marked more specific
    expect(prompt).toContain('PROJECT-SEED')
    expect(prompt).toContain('DECK-SEED')
    expect(prompt.indexOf('more specific')).toBeGreaterThan(0)
    // The layout option set and constraints are spelled out
    expect(prompt).toContain('"content" (Content)')
    expect(prompt).toContain('maxBullets')
    // Seeded images are offered by id
    expect(prompt).toContain('id "asset1"')
    // JSON output via mime type + prompt contract (deliberately no
    // responseSchema — constrained decoding degenerates; see DECISIONS)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toBeUndefined()
    expect(body.generationConfig.maxOutputTokens).toBe(2048)
    expect(prompt).toContain('"action": "new" | "update" | "none"')
    // Capacity guidance: current load and the prefer-new bias
    expect(prompt).toContain('Current slide load: 5 bullets')
    expect(prompt).toContain('Prefer "new" whenever in doubt')
    // The key travels in a header, never the URL
    expect(String(url)).not.toContain('test-key')
    expect(init.headers['x-goog-api-key']).toBe('test-key')
  })

  it('anchors the content-freedom policy to the numeric setting', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ freedom: 2 }))
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('CONTENT FREEDOM 2/10')
    expect(prompt).toContain('NEVER add topics')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ freedom: 9 }))
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('CONTENT FREEDOM 9/10')
    expect(prompt).toContain('elaborate freely')

    // Default without a setting: 3/10
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ freedom: undefined }))
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('CONTENT FREEDOM 3/10')
  })

  it('parses a valid structured response', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'update',
        layoutType: 'list',
        slots: { bullets: ['light reactions', 'dark reactions'] },
        imageGuidance: { keywords: ['chloroplast', 'diagram'] },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result).toEqual({
      action: 'update',
      layoutType: 'list',
      slots: { bullets: ['light reactions', 'dark reactions'] },
      imageGuidance: {
        keywords: ['chloroplast', 'diagram'],
        seededImageId: undefined,
        none: undefined,
      },
    })
  })

  it('coerces layouts and seeded ids the model invented', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'hologram',
        slots: { title: 'X' },
        imageGuidance: { keywords: ['x'], seededImageId: 'not-offered' },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result.layoutType).toBe('content')
    expect(result.imageGuidance?.seededImageId).toBeUndefined()
  })

  it('honors a valid seeded image selection', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'Chloroplasts' },
        imageGuidance: { keywords: ['chloroplast'], seededImageId: 'asset1' },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result.imageGuidance?.seededImageId).toBe('asset1')
  })

  it('throws on API errors with the status attached', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'quota exceeded',
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /429/,
    )
  })

  it('throws on unparseable model output', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not json {' }] } }],
      }),
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /unparseable/,
    )
  })

  it('throws when no candidate text comes back', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] }),
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /no candidate/,
    )
  })

  it('dumps the prompt and raw response when logging is enabled', async () => {
    testEnv.GENERATION_LOG_PROMPTS = true
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    try {
      await provider.generateSlideContent(request())
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toContain('===== GENERATION PROMPT')
      expect(logged).toContain('New phrase:')
      expect(logged).toContain('===== GENERATION RESPONSE')
    } finally {
      logSpy.mockRestore()
      testEnv.GENERATION_LOG_PROMPTS = false
    }
  })

  it('refuses to run without an API key', async () => {
    testEnv.GEMINI_API_KEY = undefined
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /GEMINI_API_KEY/,
    )
  })
})
