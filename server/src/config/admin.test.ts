/**
 * Unit tests for the ADMIN_EMAILS allowlist: parsing normalization and
 * the live-read admin check.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseAdminEmails, isAdminEmail } from './admin'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseAdminEmails', () => {
  it('returns an empty set for undefined or blank input', () => {
    expect(parseAdminEmails(undefined).size).toBe(0)
    expect(parseAdminEmails('').size).toBe(0)
    expect(parseAdminEmails(' ,  , ').size).toBe(0)
  })

  it('splits on commas, trims whitespace, and lowercases', () => {
    const set = parseAdminEmails(' Ada@Example.com , grace@example.com')
    expect(set).toEqual(new Set(['ada@example.com', 'grace@example.com']))
  })

  it('deduplicates case variants of the same address', () => {
    const set = parseAdminEmails('a@x.com,A@X.COM')
    expect(set.size).toBe(1)
  })
})

describe('isAdminEmail', () => {
  it('matches allowlisted emails case-insensitively', () => {
    vi.stubEnv('ADMIN_EMAILS', 'ada@example.com')
    expect(isAdminEmail('ada@example.com')).toBe(true)
    expect(isAdminEmail('ADA@example.com')).toBe(true)
    expect(isAdminEmail(' ada@example.com ')).toBe(true)
  })

  it('rejects emails not on the list', () => {
    vi.stubEnv('ADMIN_EMAILS', 'ada@example.com')
    expect(isAdminEmail('mallory@example.com')).toBe(false)
  })

  it('rejects everyone when ADMIN_EMAILS is unset', () => {
    vi.stubEnv('ADMIN_EMAILS', '')
    expect(isAdminEmail('ada@example.com')).toBe(false)
  })

  it('reads the environment at call time, not import time', () => {
    vi.stubEnv('ADMIN_EMAILS', '')
    expect(isAdminEmail('late@example.com')).toBe(false)
    vi.stubEnv('ADMIN_EMAILS', 'late@example.com')
    expect(isAdminEmail('late@example.com')).toBe(true)
  })
})
