/**
 * Unit tests for the admin password generator.
 */
import { describe, it, expect } from 'vitest'
import { generatePassword } from './password'

const hasLower = (s: string) => /[a-z]/.test(s)
const hasUpper = (s: string) => /[A-Z]/.test(s)
const hasDigit = (s: string) => /[0-9]/.test(s)
const hasSymbol = (s: string) => /[^a-zA-Z0-9]/.test(s)

describe('generatePassword', () => {
  it('defaults to 16 characters', () => {
    expect(generatePassword()).toHaveLength(16)
  })

  it('honours a requested length', () => {
    expect(generatePassword(24)).toHaveLength(24)
  })

  it('never goes below the 8-character floor', () => {
    expect(generatePassword(3)).toHaveLength(8)
  })

  it('always includes every character class', () => {
    // Run many times: the guarantee must hold on every draw, not on average.
    for (let i = 0; i < 500; i++) {
      const pw = generatePassword()
      expect(hasLower(pw)).toBe(true)
      expect(hasUpper(pw)).toBe(true)
      expect(hasDigit(pw)).toBe(true)
      expect(hasSymbol(pw)).toBe(true)
    }
  })

  it('omits ambiguous glyphs', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePassword(32)).not.toMatch(/[O0Il1]/)
    }
  })

  it('produces distinct passwords across calls', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generatePassword()))
    expect(seen.size).toBe(100)
  })
})
