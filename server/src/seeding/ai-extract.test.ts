/**
 * Unit tests for the AI extraction tier against a stubbed fetch: vision
 * descriptions parse and normalize, scanned-PDF OCR returns plain text,
 * and every failure mode — no key, API errors, malformed output,
 * timeouts — collapses to null so the keyless baseline stands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const testEnv = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key' as string | undefined,
  GEMINI_MODEL: 'gemini-test-model',
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { describeImage, ocrPdf } from './ai-extract'

const reply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text }] } }],
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

describe('describeImage', () => {
  it('sends the image inline and parses caption + keywords', async () => {
    fetchMock.mockResolvedValue(
      reply(
        JSON.stringify({
          caption: 'A chloroplast under a microscope',
          keywords: ['Chloroplast', ' MICROSCOPY '],
        }),
      ),
    )
    const result = await describeImage(Buffer.from('img-bytes'), 'image/png')
    expect(result).toEqual({
      caption: 'A chloroplast under a microscope',
      keywords: ['chloroplast', 'microscopy'],
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    const parts = body.contents[0].parts
    expect(parts[1].inlineData.mimeType).toBe('image/png')
    expect(parts[1].inlineData.data).toBe(
      Buffer.from('img-bytes').toString('base64'),
    )
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('returns null without a key, on API errors, and on bad output', async () => {
    testEnv.GEMINI_API_KEY = undefined
    expect(await describeImage(Buffer.from('x'), 'image/png')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    testEnv.GEMINI_API_KEY = 'test-key'
    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    expect(await describeImage(Buffer.from('x'), 'image/png')).toBeNull()

    fetchMock.mockResolvedValue(reply('not json'))
    expect(await describeImage(Buffer.from('x'), 'image/png')).toBeNull()

    fetchMock.mockRejectedValue(new Error('timeout'))
    expect(await describeImage(Buffer.from('x'), 'image/png')).toBeNull()
  })
})

describe('ocrPdf', () => {
  it('sends the PDF inline and returns plain text', async () => {
    fetchMock.mockResolvedValue(reply('  Page one text.\nPage two text.  '))
    const text = await ocrPdf(Buffer.from('pdf-bytes'))
    expect(text).toBe('Page one text.\nPage two text.')

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe(
      'application/pdf',
    )
    // Plain text output: no JSON mime forced
    expect(body.generationConfig.responseMimeType).toBeUndefined()
  })

  it('returns null for empty output and failures', async () => {
    fetchMock.mockResolvedValue(reply('   '))
    expect(await ocrPdf(Buffer.from('x'))).toBeNull()
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    expect(await ocrPdf(Buffer.from('x'))).toBeNull()
  })
})
