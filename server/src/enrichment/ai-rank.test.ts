/**
 * Unit tests for the image AI re-rank against a stubbed fetch: the prompt
 * carries slide + candidate metadata, the reply picks a candidate and captions
 * it, vision mode attaches thumbnails, and every failure mode returns null so
 * enrichment falls back to heuristic scoring (IMG-2). The live API is never hit.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const testEnv = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key' as string | undefined,
  GEMINI_MODEL: 'gemini-test-model',
  IMAGE_RERANK_ENABLED: true as boolean,
  IMAGE_RERANK_VISION: false as boolean,
  IMAGE_RERANK_TIMEOUT_MS: 6000,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { rankAndCaption } from './ai-rank'
import type { ImageCandidate, SlideImageContext } from './types'

const candidates: ImageCandidate[] = [
  {
    url: 'http://img/0.jpg',
    title: 'Mitochondria diagram',
    tags: ['cell', 'organelle'],
    source: 'wikimedia',
    width: 800,
    height: 600,
    attribution: { caption: 'A labelled mitochondrion' },
  },
  {
    url: 'http://img/1.jpg',
    title: 'Ripe melon',
    tags: ['fruit'],
    source: 'openverse',
    width: 800,
    height: 600,
  },
]

const ctx: SlideImageContext = {
  title: 'The Mitochondria',
  body: 'The powerhouse of the cell',
  layoutType: 'image-heavy',
  captionMaxChars: 80,
  captionMode: 'replace',
}

const geminiReply = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }),
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  testEnv.GEMINI_API_KEY = 'test-key'
  testEnv.IMAGE_RERANK_ENABLED = true
  testEnv.IMAGE_RERANK_VISION = false
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('rankAndCaption', () => {
  it('picks a candidate and captions it, carrying slide + candidate metadata', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        index: 0,
        caption: 'A mitochondrion, the cell’s powerhouse',
      }),
    )
    const res = await rankAndCaption(ctx, candidates)
    expect(res).toEqual({
      index: 0,
      caption: 'A mitochondrion, the cell’s powerhouse',
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    const parts = body.contents[0].parts as Array<Record<string, unknown>>
    const prompt = parts[0]!.text as string
    // Slide context and candidate metadata both reach the model
    expect(prompt).toContain('The Mitochondria')
    expect(prompt).toContain('Mitochondria diagram')
    expect(prompt).toContain('A labelled mitochondrion')
    // Text-only by default: no image parts
    expect(parts.some(p => 'inlineData' in p)).toBe(false)
  })

  it('returns null (→ fallback) without a key or when disabled', async () => {
    testEnv.GEMINI_API_KEY = undefined
    expect(await rankAndCaption(ctx, candidates)).toBeNull()

    testEnv.GEMINI_API_KEY = 'test-key'
    testEnv.IMAGE_RERANK_ENABLED = false
    expect(await rankAndCaption(ctx, candidates)).toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for an out-of-range or "none" (-1) index', async () => {
    fetchMock.mockResolvedValue(geminiReply({ index: 9 }))
    expect(await rankAndCaption(ctx, candidates)).toBeNull()

    fetchMock.mockResolvedValue(geminiReply({ index: -1 }))
    expect(await rankAndCaption(ctx, candidates)).toBeNull()
  })

  it('returns null on a non-200 or unparseable reply', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    expect(await rankAndCaption(ctx, candidates)).toBeNull()

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not json {' }] } }],
      }),
    })
    expect(await rankAndCaption(ctx, candidates)).toBeNull()
  })

  it('returns null for no candidates without calling the model', async () => {
    expect(await rankAndCaption(ctx, [])).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attaches candidate thumbnails in vision mode', async () => {
    testEnv.IMAGE_RERANK_VISION = true
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('generateContent')) {
        return geminiReply({ index: 1, caption: 'A ripe melon' }) as Response
      }
      // A candidate thumbnail fetch
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'image/jpeg' : null),
        },
        arrayBuffer: async () => new ArrayBuffer(16),
      } as unknown as Response
    })

    const res = await rankAndCaption(ctx, candidates)
    expect(res).toEqual({ index: 1, caption: 'A ripe melon' })

    const geminiCall = fetchMock.mock.calls.find(c =>
      String(c[0]).includes('generateContent'),
    )!
    const parts = JSON.parse(String(geminiCall[1].body)).contents[0]
      .parts as Array<Record<string, unknown>>
    expect(parts.some(p => 'inlineData' in p)).toBe(true)
  })
})
