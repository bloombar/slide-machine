/**
 * The connection check keys off the right switch (SPEC TECH-14).
 *
 * Publishing quizzes and exporting to Drive go live independently, so an
 * account can be genuinely connected for one and not the other. The two checks
 * in the action files looked like copies and were not — each read its own
 * switch — and collapsing them into one made quizzes silently follow the
 * export setting. The live-quiz integration suite caught it; this pins it
 * where it is cheap to run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const setModes = (quiz: string, exportMode: string) => {
  vi.resetModules()
  vi.doMock('../config/env', () => ({
    env: { QUIZ_PUBLISH_MODE: quiz, EXPORT_MODE: exportMode },
  }))
}

const loadIsConnected = async () =>
  (await import('./google-connection')).isConnected

/** Mock-mode connection: a flag, no stored grant. */
const flagOnly = { googleConnected: true }
/** Live-mode connection: a real stored grant. */
const tokenOnly = { googleQuizRefreshToken: 'encrypted' }

beforeEach(() => vi.resetModules())
afterEach(() => vi.doUnmock('../config/env'))

describe('isConnected', () => {
  it('accepts the mock flag when its own surface is not live', async () => {
    setModes('mock', 'mock')
    const isConnected = await loadIsConnected()
    expect(isConnected(flagOnly, 'quiz')).toBe(true)
    expect(isConnected(flagOnly, 'export')).toBe(true)
  })

  it('requires a stored grant when its own surface is live', async () => {
    setModes('live', 'live')
    const isConnected = await loadIsConnected()
    expect(isConnected(flagOnly, 'quiz')).toBe(false)
    expect(isConnected(tokenOnly, 'quiz')).toBe(true)
  })

  // The regression, both ways round: one surface going live must not drag
  // the other with it.
  it('does not let a live quiz setting bind the export surface', async () => {
    setModes('live', 'mock')
    const isConnected = await loadIsConnected()
    expect(isConnected(flagOnly, 'quiz')).toBe(false)
    expect(isConnected(flagOnly, 'export')).toBe(true)
  })

  it('does not let a live export setting bind the quiz surface', async () => {
    setModes('mock', 'live')
    const isConnected = await loadIsConnected()
    expect(isConnected(flagOnly, 'quiz')).toBe(true)
    expect(isConnected(flagOnly, 'export')).toBe(false)
  })

  it('treats an account with neither as disconnected on both', async () => {
    setModes('mock', 'mock')
    const isConnected = await loadIsConnected()
    expect(isConnected({}, 'quiz')).toBe(false)
    expect(isConnected({}, 'export')).toBe(false)
  })
})
