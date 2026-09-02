/**
 * Unit tests for `safeReturnTo` (routes/google-connect.ts): the guard that
 * decides whether a post-sign-in / post-connect redirect target is safe to
 * send the browser to. Origin comparison, not string-prefix matching — see
 * the function's docstring for the bug this closes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { testEnv } = vi.hoisted(() => ({
  testEnv: {
    NODE_ENV: 'development' as 'development' | 'test' | 'production',
    PUBLIC_BASE_URL: 'https://slides.example.edu' as string | undefined,
  },
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { safeReturnTo } from './google-connect'

beforeEach(() => {
  testEnv.NODE_ENV = 'development'
  testEnv.PUBLIC_BASE_URL = 'https://slides.example.edu'
})

describe('safeReturnTo', () => {
  it('rejects a host that merely starts with our origin (the open-redirect bug)', () => {
    // https://slides.example.edu.attacker.test/ passes a startsWith() check
    // against https://slides.example.edu but is a completely different
    // origin an attacker controls.
    expect(safeReturnTo('https://slides.example.edu.attacker.test/')).toBe(
      testEnv.PUBLIC_BASE_URL,
    )
  })

  it('rejects a lookalike subdomain', () => {
    expect(safeReturnTo('https://slides.example.edu.evil.test/x')).toBe(
      testEnv.PUBLIC_BASE_URL,
    )
  })

  it('rejects a protocol-relative URL (//host resolves off our origin)', () => {
    expect(safeReturnTo('//evil.test')).toBe(testEnv.PUBLIC_BASE_URL)
  })

  it('rejects a backslash-prefixed URL (browsers treat /\\ like //)', () => {
    expect(safeReturnTo('/\\evil.test')).toBe(testEnv.PUBLIC_BASE_URL)
  })

  it('rejects a javascript: URL', () => {
    expect(safeReturnTo('javascript:alert(1)')).toBe(testEnv.PUBLIC_BASE_URL)
  })

  it('does not throw on garbage input that is not a URL at all', () => {
    expect(() => safeReturnTo('not a url \0 at all')).not.toThrow()
    expect(safeReturnTo('not a url \0 at all')).toBe(testEnv.PUBLIC_BASE_URL)
  })

  it('accepts an absolute URL on our own origin', () => {
    expect(safeReturnTo('https://slides.example.edu/deck/123')).toBe(
      'https://slides.example.edu/deck/123',
    )
  })

  it('accepts a bare path', () => {
    expect(safeReturnTo('/deck/123')).toBe('/deck/123')
  })

  it('accepts localhost in development', () => {
    testEnv.NODE_ENV = 'development'
    expect(safeReturnTo('http://localhost:5173/deck/123')).toBe(
      'http://localhost:5173/deck/123',
    )
  })

  it('accepts 127.0.0.1 in development', () => {
    testEnv.NODE_ENV = 'development'
    expect(safeReturnTo('http://127.0.0.1:5173/deck/123')).toBe(
      'http://127.0.0.1:5173/deck/123',
    )
  })

  it('rejects localhost in production', () => {
    testEnv.NODE_ENV = 'production'
    expect(safeReturnTo('http://localhost:5173/deck/123')).toBe(
      testEnv.PUBLIC_BASE_URL,
    )
  })
})
