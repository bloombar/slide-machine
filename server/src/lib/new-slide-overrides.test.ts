/**
 * Unit tests for the GEN-8 new-slide override resolver: absent/undefined
 * means the override is ON (current behaviour), matching every other
 * lecture-level toggle.
 */
import { describe, it, expect } from 'vitest'
import { isNewSlideOverrideOn } from './new-slide-overrides'

describe('isNewSlideOverrideOn', () => {
  it('is on when the stored value is absent', () => {
    expect(isNewSlideOverrideOn(undefined)).toBe(true)
  })

  it('is on when explicitly set true', () => {
    expect(isNewSlideOverrideOn(true)).toBe(true)
  })

  it('is off only when explicitly set false', () => {
    expect(isNewSlideOverrideOn(false)).toBe(false)
  })
})
