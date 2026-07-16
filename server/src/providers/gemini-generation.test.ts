/**
 * Unit tests for the Gemini adapter against a stubbed fetch: prompt
 * assembly (seed layers, layouts, seeded images), response parsing and
 * validation, layout/seeded-id drift correction, and failure modes.
 * The live API is never called from tests.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { SlideGenerationRequest } from '@slide-machine/shared'
import { VOICE_COMMAND_DESCRIPTORS } from '@slide-machine/shared'
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
import { GenerationUnavailableError } from './errors'

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
      slots: [
        { name: 'title', kind: 'text', label: 'Slide title', maxChars: 50 },
        { name: 'body', kind: 'text', label: 'Slide body' },
      ],
      constraints: { maxBodyChars: 400 },
    },
    {
      type: 'list',
      label: 'Bullet list',
      purpose: '3-6 parallel points',
      slots: [
        { name: 'title', kind: 'text', label: 'Slide title' },
        { name: 'bullets', kind: 'bullets', label: 'Slide bullets' },
      ],
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
  currentSlide: { layoutType: 'list', bulletCount: 5, bodyChars: 0 },
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
    // The layout option set and constraints are spelled out, with
    // per-slot budgets riding on the slot names
    expect(prompt).toContain('"content" (Content)')
    expect(prompt).toContain('title (max 50 chars)')
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
    // No language resolved anywhere: no language directive
    expect(prompt).not.toContain('IETF tag')
    // The key travels in a header, never the URL
    expect(String(url)).not.toContain('test-key')
    expect(init.headers['x-goog-api-key']).toBe('test-key')
  })

  it('tolerates responses that omit layoutType (none / delta updates)', async () => {
    // A bare "none" — exactly what the live model returned mid-lecture
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    let result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')

    // An update without a layout claim keeps the slide's own layout
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'update', slots: { bullets: ['more'] } }),
    )
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('update')
    expect(result.layoutType).toBe('list') // currentSlide.layoutType
  })

  it('asks for and accepts a deck title only when requested', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'T' },
        deckTitle: '  Photosynthesis 101  ',
      }),
    )
    let result = await provider.generateSlideContent(
      request({ suggestDeckTitle: true }),
    )
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('"deckTitle"?: string')
    expect(prompt).toContain('no title yet')
    expect(result.deckTitle).toBe('Photosynthesis 101')

    // Unrequested claims are dropped, and the prompt never mentions it
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'T' },
        deckTitle: 'Sneaky',
      }),
    )
    result = await provider.generateSlideContent(request())
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).not.toContain('deckTitle')
    expect(result.deckTitle).toBeUndefined()
  })

  it('pins the output language when the request resolves one', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ language: 'fr' }))
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain(
      'Write ALL slide text in the language with IETF tag "fr"',
    )
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

  it('offers refit semantics only when allowLayoutRefit rides along with slide content', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request())
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).not.toContain('updateMode')
    expect(prompt).not.toContain('Current slide content:')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        currentSlide: {
          layoutType: 'content',
          bulletCount: 0,
          bodyChars: 40,
          content: { title: 'Membranes', body: 'A phospholipid bilayer' },
        },
      }),
    )
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('"updateMode"?: "delta" | "refit"')
    expect(prompt).toContain('Keep layoutType "content"')
    expect(prompt).toContain(
      'Current slide content: {"title":"Membranes","body":"A phospholipid bilayer"}',
    )
  })

  it('passes updateMode through only when refit was offered', async () => {
    const reply = {
      action: 'update',
      updateMode: 'refit',
      layoutType: 'list',
      slots: { title: 'Membranes', bullets: ['bilayer', 'proteins'] },
    }
    fetchMock.mockResolvedValue(geminiReply(reply))
    let result = await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        currentSlide: {
          layoutType: 'content',
          bulletCount: 0,
          bodyChars: 40,
          content: { title: 'Membranes', body: 'A phospholipid bilayer' },
        },
      }),
    )
    expect(result.updateMode).toBe('refit')
    expect(result.layoutType).toBe('list')

    // Same reply without the offer: the claim is stripped
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(geminiReply(reply))
    result = await provider.generateSlideContent(request())
    expect(result.updateMode).toBeUndefined()
  })

  it('offers the "command" action only when voice commands ride along', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request())
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).not.toContain('"command"')
    expect(prompt).not.toContain('Command ids:')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(
      request({ voiceCommands: VOICE_COMMAND_DESCRIPTORS }),
    )
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('"action": "new" | "update" | "none" | "command"')
    expect(prompt).toContain('Command ids:')
    expect(prompt).toContain('- "next": Advance to the next slide')
    expect(prompt).toContain('- "newSlide": Append a new blank slide')
  })

  it('returns a recognized command and drops any content fields', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'command',
        command: 'previous',
        layoutType: 'hologram',
        slots: { title: 'stray content' },
      }),
    )
    const result = await provider.generateSlideContent(
      request({ voiceCommands: VOICE_COMMAND_DESCRIPTORS }),
    )
    expect(result).toEqual({
      action: 'command',
      command: 'previous',
      layoutType: 'content',
      slots: {},
    })
  })

  it('degrades invented or unoffered command claims to none', async () => {
    // A command id we never defined
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'command', command: 'jazzhands', slots: {} }),
    )
    let result = await provider.generateSlideContent(
      request({ voiceCommands: VOICE_COMMAND_DESCRIPTORS }),
    )
    expect(result.action).toBe('none')
    expect(result.command).toBeUndefined()

    // A real id, but commands were never offered in this request
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'command', command: 'next', slots: {} }),
    )
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')
    expect(result.command).toBeUndefined()
  })

  it('throws on other API errors with the status attached', async () => {
    // 429/503 map to friendly errors (covered below); other statuses keep
    // the raw status for debugging.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /400/,
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

  it('maps quota/credit exhaustion (429) to a non-retryable friendly error', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429),
    )
    const err = await provider
      .generateSlideContent(request())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GenerationUnavailableError)
    expect((err as GenerationUnavailableError).retryable).toBe(false)
    expect((err as Error).message).toMatch(/quota or credits/)
  })

  it('maps provider overload (503) to a retryable friendly error', async () => {
    fetchMock.mockResolvedValue(geminiReply({ error: { code: 503 } }, 503))
    const err = await provider
      .generateSlideContent(request())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GenerationUnavailableError)
    expect((err as GenerationUnavailableError).retryable).toBe(true)
    expect((err as Error).message).toMatch(/temporarily busy/)
  })
})
