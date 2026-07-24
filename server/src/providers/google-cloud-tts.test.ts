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
  it('posts SSML with marks + timepointing and decodes the base64 audio', async () => {
    const audioContent = Buffer.from('hello-mp3').toString('base64')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent, timepoints: [] }),
    })

    const provider = new GoogleCloudTtsProvider()
    const { audio } = await provider.synthesize({
      text: 'Hello there. How are you?',
      languageCode: 'en-US',
    })
    expect(Buffer.from(audio).toString()).toBe('hello-mp3')
    expect(provider.audioMimeType).toBe('audio/mpeg')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('v1beta1')
    expect(String(url)).toContain('text:synthesize')
    expect(init.headers['x-goog-api-key']).toBe('tts-key')
    const body = JSON.parse(String(init.body))
    // SSML (not plain text) with a <mark> per phrase, and timepointing on.
    expect(body.input.ssml).toContain('<mark name="m0"/>')
    expect(body.input.ssml).toContain('Hello there.')
    expect(body.enableTimePointing).toEqual(['SSML_MARK'])
    expect(body.voice.languageCode).toBe('en-US')
    expect(body.audioConfig.audioEncoding).toBe('MP3')
  })

  it('maps returned timepoints to plain-text char offsets', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        audioContent: Buffer.from('x').toString('base64'),
        // 'One. Two.' → phrase 'One.' at 0, phrase 'Two.' at 5.
        timepoints: [
          { markName: 'm1', timeSeconds: 1.5 },
          { markName: 'm0', timeSeconds: 0.2 },
        ],
      }),
    })
    const { marks } = await new GoogleCloudTtsProvider().synthesize({
      text: 'One. Two.',
      languageCode: 'en-US',
    })
    // Sorted by charOffset, joined back to plain-text positions.
    expect(marks).toEqual([
      { charOffset: 0, timeSeconds: 0.2 },
      { charOffset: 5, timeSeconds: 1.5 },
    ])
  })

  it('sends the voice name and gender when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent: Buffer.from('x').toString('base64') }),
    })
    await new GoogleCloudTtsProvider().synthesize({
      text: 'hi',
      languageCode: 'fr-FR',
      voiceName: 'fr-FR-Neural2-A',
      gender: 'female',
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.voice.name).toBe('fr-FR-Neural2-A')
    expect(body.voice.ssmlGender).toBe('FEMALE')
  })

  it('sends gender only (no name) for a cross-language voice', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent: Buffer.from('x').toString('base64') }),
    })
    await new GoogleCloudTtsProvider().synthesize({
      text: 'hi',
      languageCode: 'de-DE',
      gender: 'male',
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.voice.name).toBeUndefined()
    expect(body.voice.ssmlGender).toBe('MALE')
  })

  it('falls back to plain text with no marks when the voice rejects SSML', async () => {
    // First (SSML) call 400s; provider retries with plain text.
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'bad',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          audioContent: Buffer.from('plain').toString('base64'),
        }),
      })
    const { audio, marks } = await new GoogleCloudTtsProvider().synthesize({
      text: 'Hi there.',
      languageCode: 'en-US',
    })
    expect(Buffer.from(audio).toString()).toBe('plain')
    expect(marks).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1].body))
    expect(second.input.text).toBe('Hi there.')
    expect(second.input.ssml).toBeUndefined()
    expect(second.enableTimePointing).toBeUndefined()
  })

  it('throws without a key and on a non-400 error response', async () => {
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
