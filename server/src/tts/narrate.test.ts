/** Unit tests for slide narration: key gating and graceful null fallback. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const testEnv = vi.hoisted(() => ({
  GEMINI_API_KEY: 'gem-key' as string | undefined,
  GEMINI_MODEL: 'gemini-test',
  GEMINI_TIMEOUT_MS: 12_000,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { narrateSlide } from './narrate'

const reply = (text: string) => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  testEnv.GEMINI_API_KEY = 'gem-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('narrateSlide', () => {
  it('returns the model narration', async () => {
    fetchMock.mockResolvedValue(reply('  Plants turn light into energy.  '))
    expect(await narrateSlide('Photosynthesis', 'en-US')).toBe(
      'Plants turn light into energy.',
    )
  })

  it('returns null without a key or for empty content (no fetch)', async () => {
    testEnv.GEMINI_API_KEY = undefined
    expect(await narrateSlide('x', 'en-US')).toBeNull()
    testEnv.GEMINI_API_KEY = 'gem-key'
    expect(await narrateSlide('   ', 'en-US')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on a failed or empty response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    expect(await narrateSlide('x', 'en-US')).toBeNull()
    fetchMock.mockResolvedValue(reply(''))
    expect(await narrateSlide('x', 'en-US')).toBeNull()
  })
})
