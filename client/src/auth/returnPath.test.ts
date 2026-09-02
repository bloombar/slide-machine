/**
 * Unit tests for the OAuth return path (AUTH-8): what counts as a safe
 * same-origin path, that it is used exactly once, and that blocked storage
 * degrades to "no return path" rather than throwing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isSafeReturnPath,
  rememberReturnPath,
  takeReturnPath,
} from './returnPath'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('isSafeReturnPath', () => {
  it('accepts an ordinary in-app path, query and all', () => {
    expect(isSafeReturnPath('/d/shared-abc123')).toBe(true)
    expect(isSafeReturnPath('/d/shared-abc123?slide=s2')).toBe(true)
  })

  it('rejects anything that could leave this origin', () => {
    // Protocol-relative: the browser reads these as another host
    expect(isSafeReturnPath('//evil.test/pwn')).toBe(false)
    expect(isSafeReturnPath('/\\evil.test/pwn')).toBe(false)
    // Absolute URLs and schemes, including a look-alike host that a raw
    // startsWith check against our own base URL would wave through
    expect(isSafeReturnPath('https://evil.test/pwn')).toBe(false)
    expect(isSafeReturnPath('http://localhost.evil.test/')).toBe(false)
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false)
    // Not a path at all
    expect(isSafeReturnPath('d/no-leading-slash')).toBe(false)
    expect(isSafeReturnPath('')).toBe(false)
    expect(isSafeReturnPath(null)).toBe(false)
    expect(isSafeReturnPath(42)).toBe(false)
  })
})

describe('rememberReturnPath / takeReturnPath', () => {
  it('hands back the parked path', () => {
    rememberReturnPath('/d/shared-abc123?slide=s2')
    expect(takeReturnPath()).toBe('/d/shared-abc123?slide=s2')
  })

  it('is single-use, so a later plain visit is not redirected', () => {
    rememberReturnPath('/d/shared-abc123')
    expect(takeReturnPath()).toBe('/d/shared-abc123')
    expect(takeReturnPath()).toBeNull()
  })

  it('never parks an unsafe path', () => {
    rememberReturnPath('https://evil.test/pwn')
    expect(takeReturnPath()).toBeNull()
  })

  // Defence in depth: the only writer is our own code, but a value read back
  // from storage is still validated rather than trusted.
  it('refuses an unsafe value planted directly in storage', () => {
    sessionStorage.setItem('sm:auth-return', '//evil.test/pwn')
    expect(takeReturnPath()).toBeNull()
  })

  it('degrades quietly when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => rememberReturnPath('/d/shared-abc123')).not.toThrow()
    expect(takeReturnPath()).toBeNull()
  })
})
