/**
 * Unit tests for the Google Cloud Translation adapter against a stubbed fetch:
 * request shape, locale mapping, batching, key gating, result-count checking,
 * and the health probe. No API is called.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const testEnv = vi.hoisted(() => ({
  TRANSLATION_PROVIDER: 'google-cloud',
  GOOGLE_CLOUD_TRANSLATION_KEY: 'translate-key' as string | undefined,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import {
  GoogleCloudTranslationProvider,
  batchSegments,
  pingGoogleTranslation,
} from './google-cloud-translation'

let fetchMock: ReturnType<typeof vi.fn>

/** A v2 response echoing one translation per input. */
const respondWith = (texts: string[]) => ({
  ok: true,
  json: async () => ({
    data: { translations: texts.map(t => ({ translatedText: t })) },
  }),
})

beforeEach(() => {
  testEnv.GOOGLE_CLOUD_TRANSLATION_KEY = 'translate-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('GoogleCloudTranslationProvider.translate', () => {
  it('posts the batch with the key, target and html format', async () => {
    fetchMock.mockResolvedValue(respondWith(['<p>bonjour</p>']))

    const provider = new GoogleCloudTranslationProvider()
    const out = await provider.translate({
      texts: ['<p>hello</p>'],
      source: 'en',
      target: 'fr',
      format: 'html',
    })
    expect(out).toEqual(['<p>bonjour</p>'])

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('translation.googleapis.com')
    expect(init.headers['x-goog-api-key']).toBe('translate-key')
    const body = JSON.parse(String(init.body))
    expect(body.q).toEqual(['<p>hello</p>'])
    expect(body.source).toBe('en')
    expect(body.target).toBe('fr')
    expect(body.format).toBe('html')
  })

  it('maps Mandarin to the Translate code, not the speech one', async () => {
    fetchMock.mockResolvedValue(respondWith(['x']))
    await new GoogleCloudTranslationProvider().translate({
      texts: ['a'],
      target: 'zh',
      format: 'text',
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    // cmn-Hans-CN is the Speech-to-Text code and Translate rejects it
    expect(body.target).toBe('zh-CN')
  })

  it('omits source when the caller does not know it', async () => {
    fetchMock.mockResolvedValue(respondWith(['x']))
    await new GoogleCloudTranslationProvider().translate({
      texts: ['a'],
      target: 'es',
      format: 'text',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).source).toBe(
      undefined,
    )
  })

  it('returns an empty result without calling the API', async () => {
    const out = await new GoogleCloudTranslationProvider().translate({
      texts: [],
      target: 'fr',
      format: 'html',
    })
    expect(out).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('splits a long deck into several requests and keeps the order', async () => {
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`)
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { q: string[] }
      return respondWith(body.q.map(q => `${q}-fr`))
    })

    const out = await new GoogleCloudTranslationProvider().translate({
      texts,
      target: 'fr',
      format: 'text',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(out).toHaveLength(250)
    expect(out[0]).toBe('t0-fr')
    expect(out[249]).toBe('t249-fr')
  })

  it('throws without a key rather than calling the API', async () => {
    testEnv.GOOGLE_CLOUD_TRANSLATION_KEY = undefined
    await expect(
      new GoogleCloudTranslationProvider().translate({
        texts: ['a'],
        target: 'fr',
        format: 'text',
      }),
    ).rejects.toThrow(/not configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    })
    await expect(
      new GoogleCloudTranslationProvider().translate({
        texts: ['a'],
        target: 'fr',
        format: 'text',
      }),
    ).rejects.toThrow(/403/)
  })

  it('throws when the provider returns the wrong number of results', async () => {
    // Silently misaligning results would put one slide's words on another.
    fetchMock.mockResolvedValue(respondWith(['only-one']))
    await expect(
      new GoogleCloudTranslationProvider().translate({
        texts: ['a', 'b'],
        target: 'fr',
        format: 'text',
      }),
    ).rejects.toThrow(/2 inputs/)
  })

  it('falls back to the original text when a translation comes back empty', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { translations: [{}] } }),
    })
    const out = await new GoogleCloudTranslationProvider().translate({
      texts: ['keep me'],
      target: 'fr',
      format: 'text',
    })
    expect(out).toEqual(['keep me'])
  })
})

describe('batchSegments', () => {
  it('caps a batch by segment count', () => {
    const batches = batchSegments(Array.from({ length: 205 }, () => 'a'))
    expect(batches.map(b => b.length)).toEqual([100, 100, 5])
  })

  it('caps a batch by total characters', () => {
    const big = 'x'.repeat(9000)
    expect(batchSegments([big, big, big]).map(b => b.length)).toEqual([1, 1, 1])
  })

  it('still sends an oversized single segment on its own', () => {
    const huge = 'x'.repeat(40_000)
    expect(batchSegments([huge])).toEqual([[huge]])
  })

  it('returns nothing for no input', () => {
    expect(batchSegments([])).toEqual([])
  })
})

describe('pingGoogleTranslation', () => {
  it('reads as disabled without a key', async () => {
    testEnv.GOOGLE_CLOUD_TRANSLATION_KEY = undefined
    expect(await pingGoogleTranslation()).toEqual({
      status: 'disabled',
      detail: 'no key',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads as ok when the languages call succeeds', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    expect(await pingGoogleTranslation()).toEqual({
      status: 'ok',
      detail: 'ready',
    })
  })

  it('reads as down on a failed call', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    expect(await pingGoogleTranslation()).toEqual({
      status: 'down',
      detail: 'http 401',
    })
  })

  it('never throws when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await pingGoogleTranslation()).toEqual({
      status: 'down',
      detail: 'error',
    })
  })
})
