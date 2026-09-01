/**
 * Unit tests for the lecture links an MCP tool hands back (docs/MCP.md §4).
 *
 * The precedence and the missing-origin case are what matter. A link is the
 * only way an assistant can show an instructor what it changed — it cannot see
 * the slides — so one built against the API port instead of the app's, or one
 * printed with the word "undefined" in it, is a dead end at the far end of a
 * conversation this code never sees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const testEnv = vi.hoisted(() => ({
  CLIENT_APP_URL: undefined as string | undefined,
  PUBLIC_BASE_URL: undefined as string | undefined,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { lectureUrl } from './deck-link'

beforeEach(() => {
  testEnv.CLIENT_APP_URL = undefined
  testEnv.PUBLIC_BASE_URL = 'https://slides.example.com'
})

describe('lectureUrl', () => {
  it('addresses the lecture by its permalink slug', () => {
    expect(lectureUrl('week-4-recursion')).toBe(
      'https://slides.example.com/d/week-4-recursion',
    )
  })

  it('names a slide in the query string, not the fragment', () => {
    // A fragment never reaches the server and does not survive the sign-in
    // round trip, which is the journey a link from a chat window takes.
    const url = lectureUrl('week-4-recursion', 'slide-7')

    expect(url).toBe(
      'https://slides.example.com/d/week-4-recursion?slide=slide-7',
    )
    expect(url).not.toContain('#')
  })

  it('prefers the SPA origin over the API one', () => {
    // In local dev the viewer is on Vite and the API is not; the API port
    // would open a page that does not exist.
    testEnv.CLIENT_APP_URL = 'http://localhost:5173'

    expect(lectureUrl('week-4')).toBe('http://localhost:5173/d/week-4')
  })

  it('gives no link at all when no origin is configured', () => {
    // Rather than a relative path, which means nothing in someone else's
    // chat client.
    testEnv.PUBLIC_BASE_URL = undefined

    expect(lectureUrl('week-4')).toBeUndefined()
    expect(lectureUrl('week-4', 'slide-1')).toBeUndefined()
  })

  it('gives no link for a lecture with no slug', () => {
    expect(lectureUrl('')).toBeUndefined()
  })

  it('escapes what it is given', () => {
    expect(lectureUrl('a b', 'x/y')).toBe(
      'https://slides.example.com/d/a%20b?slide=x%2Fy',
    )
  })
})
