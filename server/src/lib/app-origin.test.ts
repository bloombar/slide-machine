/**
 * Unit tests for the app-origin helper (BILL-2). The precedence matters more
 * than it looks: it decides where a payment provider sends the browser back
 * to, so getting it wrong strands a paying user on a page that does not
 * exist — or, worse, somewhere an attacker chose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request } from 'express'

const testEnv = vi.hoisted(() => ({
  CLIENT_APP_URL: undefined as string | undefined,
  PUBLIC_BASE_URL: undefined as string | undefined,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { appOrigin, configuredAppOrigin } from './app-origin'

/** A request carrying the headers the fallback reads, plus a hostile Origin
 * that must never be believed. */
const req = (host = 'api.example.com'): Request =>
  ({
    protocol: 'https',
    get: (header: string) =>
      header.toLowerCase() === 'host' ? host : 'https://evil.example.com',
  }) as unknown as Request

beforeEach(() => {
  testEnv.CLIENT_APP_URL = undefined
  testEnv.PUBLIC_BASE_URL = undefined
})

describe('appOrigin', () => {
  it('prefers the configured client origin', () => {
    // In local dev the SPA is on Vite and the API is not; returning to the
    // API port would land the user nowhere.
    testEnv.CLIENT_APP_URL = 'http://localhost:5173'
    testEnv.PUBLIC_BASE_URL = 'http://localhost:3000'

    expect(appOrigin(req())).toBe('http://localhost:5173')
  })

  it('falls back to the public base URL', () => {
    testEnv.PUBLIC_BASE_URL = 'https://slides.example.com'

    expect(appOrigin(req())).toBe('https://slides.example.com')
  })

  it('falls back to the host the request arrived on', () => {
    expect(appOrigin(req())).toBe('https://api.example.com')
  })

  it('never takes the origin from a client-supplied header', () => {
    // `get('origin')` returns the hostile value in this fixture; a return URL
    // built from it would let anyone redirect a checkout wherever they liked.
    expect(appOrigin(req())).not.toContain('evil.example.com')
  })
})

describe('configuredAppOrigin', () => {
  it('answers with the configured origin, request or no request', () => {
    testEnv.CLIENT_APP_URL = 'http://localhost:5173'
    testEnv.PUBLIC_BASE_URL = 'http://localhost:3000'

    expect(configuredAppOrigin()).toBe('http://localhost:5173')
  })

  it('is undefined when nothing is configured', () => {
    // A caller with no request has nothing to guess from, so it must be told
    // there is no answer rather than handed one (deck-link.ts).
    expect(configuredAppOrigin()).toBeUndefined()
  })
})
