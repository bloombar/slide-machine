/**
 * Unit tests for the GEN-8 new-slide override resolver: an absent/undefined
 * stored value falls back to the switch's own default; an explicit value
 * always wins.
 */
import { describe, it, expect } from 'vitest'
import {
  isNewSlideOverrideOn,
  NEW_SLIDE_OVERRIDE_DEFAULTS,
} from './new-slide-overrides'

describe('isNewSlideOverrideOn', () => {
  it('is on when the stored value is absent (default-on switch)', () => {
    expect(isNewSlideOverrideOn(undefined)).toBe(true)
  })

  it('is on when explicitly set true', () => {
    expect(isNewSlideOverrideOn(true)).toBe(true)
  })

  it('is off only when explicitly set false', () => {
    expect(isNewSlideOverrideOn(false)).toBe(false)
  })

  it('falls back to an explicit default-off when the stored value is absent', () => {
    expect(isNewSlideOverrideOn(undefined, false)).toBe(false)
  })

  it('still honours an explicit true against a default-off switch', () => {
    expect(isNewSlideOverrideOn(true, false)).toBe(true)
  })

  it('still honours an explicit false against a default-off switch', () => {
    expect(isNewSlideOverrideOn(false, false)).toBe(false)
  })

  it('overflow (and Refine trimming) default off; the other three default on', () => {
    expect(NEW_SLIDE_OVERRIDE_DEFAULTS).toEqual({
      header: true,
      overflow: false,
      whiteboard: true,
      drawing: true,
    })
  })
})
