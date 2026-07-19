/**
 * Unit tests for the Google Cloud TTS adapter against a stubbed fetch: request
 * shape, base64 decoding, key gating, and the health probe. No API is called.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const testEnv = vi.hoisted(() => ({
  GEMINI_MODEL: 'gemini-test',
  TTS_PROVIDER: 'google-cloud',
  GOOGLE_CLOUD_TTS_KEY: 'tts-key' as string | undefined,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { GoogleCloudTtsProvider, pingGoogleTts } from './google-cloud-tts'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  testEnv.GOOGLE_CLOUD_TTS_KEY = 'tts-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('GoogleCloudTtsProvider.synthesize', () => {
  it('posts the synthesize request and decodes the base64 audio', async () => {
    const audioContent = Buffer.from('hello-mp3').toString('base64')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent }),
    })

    const provider = new GoogleCloudTtsProvider()
    const audio = await provider.synthesize({
      text: 'Hello there',
      languageCode: 'en-US',
    })
    expect(Buffer.from(audio).toString()).toBe('hello-mp3')
    expect(provider.audioMimeType).toBe('audio/mpeg')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('text:synthesize')
    expect(init.headers['x-goog-api-key']).toBe('tts-key')
    const body = JSON.parse(String(init.body))
    expect(body.input.text).toBe('Hello there')
    expect(body.voice.languageCode).toBe('en-US')
    expect(body.audioConfig.audioEncoding).toBe('MP3')
  })

  it('throws without a key and on a non-200 response', async () => {
    testEnv.GOOGLE_CLOUD_TTS_KEY = undefined
    await expect(
      new GoogleCloudTtsProvider().synthesize({
        text: 'x',
        languageCode: 'en-US',
      }),
    ).rejects.toThrow(/not configured/)

    testEnv.GOOGLE_CLOUD_TTS_KEY = 'tts-key'
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'nope',
    })
    await expect(
      new GoogleCloudTtsProvider().synthesize({
        text: 'x',
        languageCode: 'en-US',
      }),
    ).rejects.toThrow(/403/)
  })
})

describe('pingGoogleTts', () => {
  it('is disabled without a key', async () => {
    testEnv.GOOGLE_CLOUD_TTS_KEY = undefined
    expect(await pingGoogleTts()).toEqual({
      status: 'disabled',
      detail: 'no key',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('probes voices and maps the result', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    expect((await pingGoogleTts()).status).toBe('ok')

    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    expect((await pingGoogleTts()).status).toBe('down')
  })
})
