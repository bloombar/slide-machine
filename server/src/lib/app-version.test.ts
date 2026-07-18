/**
 * Unit tests for CalVer version resolution: the APP_VERSION override wins,
 * and otherwise the string is `YYYY.MM.DD` optionally suffixed with a git
 * short-sha (this repo has a `.git`, so the suffix is present here).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { computeAppVersion } from './app-version'

const CALVER = /^\d{4}\.\d{2}\.\d{2}(\+[0-9a-f]{7,40})?$/

afterEach(() => {
  delete process.env.APP_VERSION
})

describe('computeAppVersion', () => {
  it('honors an explicit APP_VERSION override', () => {
    process.env.APP_VERSION = '2026.01.02+deadbee'
    expect(computeAppVersion()).toBe('2026.01.02+deadbee')
  })

  it('produces a CalVer date, with a git sha when available', () => {
    const version = computeAppVersion()
    expect(version).toMatch(CALVER)
    // Running inside the repo, the git sha suffix should be present.
    expect(version).toContain('+')
  })
})
