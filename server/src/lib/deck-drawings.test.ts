/**
 * Unit tests for the whiteboard export helpers: which strokes are visible in an
 * export (erased/orphaned hidden), and hex-color parsing for pdf-lib and pptx.
 */
import { describe, it, expect } from 'vitest'
import type { Stroke } from '@slide-machine/shared'
import { visibleStrokes, hexToRgb01, hexForPptx } from './deck-drawings'

const stroke = (over: Partial<Stroke>): Stroke => ({
  id: 'x',
  tool: 'pen',
  color: '#000000',
  thickness: 0.005,
  points: [{ x: 0, y: 0 }],
  startedAt: '',
  endedAt: '',
  anchor: { charAnchor: 0, source: 'unsynced' },
  ...over,
})

describe('visibleStrokes', () => {
  it('keeps drawn strokes but hides erased and orphaned ones', () => {
    const drawn = stroke({ id: 'a' })
    const erased = stroke({
      id: 'b',
      erasedAnchor: { charAnchor: 1, source: 'unsynced' },
    })
    const orphaned = stroke({
      id: 'c',
      anchor: { charAnchor: 0, source: 'word', orphaned: true },
    })
    expect(visibleStrokes([drawn, erased, orphaned]).map(s => s.id)).toEqual([
      'a',
    ])
  })

  it('handles an absent drawings array', () => {
    expect(visibleStrokes(undefined)).toEqual([])
  })
})

describe('hexToRgb01', () => {
  it('parses #rrggbb and #rgb to 0..1 components', () => {
    expect(hexToRgb01('#ffffff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb01('#000')).toEqual({ r: 0, g: 0, b: 0 })
    const red = hexToRgb01('#e11d48')
    expect(red.r).toBeCloseTo(0xe1 / 255)
    expect(red.g).toBeCloseTo(0x1d / 255)
  })

  it('falls back to black for garbage', () => {
    expect(hexToRgb01('not-a-color')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('hexForPptx', () => {
  it('normalizes to 6-digit uppercase hex without #', () => {
    expect(hexForPptx('#e11d48')).toBe('E11D48')
    expect(hexForPptx('#abc')).toBe('AABBCC')
    expect(hexForPptx('zzz')).toBe('000000')
  })
})
