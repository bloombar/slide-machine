import { describe, expect, it } from 'vitest'
import {
  anchorFraction,
  charTimeFromMarks,
  remapAnchor,
} from './drawing-anchor'
import type { TtsMark } from '../providers/tts'

describe('anchorFraction', () => {
  it('returns the proportional position of an offset', () => {
    expect(anchorFraction(50, 100)).toBe(0.5)
    expect(anchorFraction(0, 100)).toBe(0)
    expect(anchorFraction(100, 100)).toBe(1)
  })

  it('guards a zero/negative-length transcript', () => {
    expect(anchorFraction(10, 0)).toBe(0)
    expect(anchorFraction(10, -5)).toBe(0)
  })

  it('clamps out-of-range offsets to [0, 1]', () => {
    expect(anchorFraction(-10, 100)).toBe(0)
    expect(anchorFraction(150, 100)).toBe(1)
  })
})

describe('remapAnchor', () => {
  it('rescales an anchor proportionally to the new length', () => {
    expect(remapAnchor(30, 100, 200)).toBe(60)
    expect(remapAnchor(50, 100, 50)).toBe(25)
  })

  it('rounds to the nearest character', () => {
    expect(remapAnchor(1, 3, 10)).toBe(3) // 3.33 -> 3
    expect(remapAnchor(2, 3, 10)).toBe(7) // 6.67 -> 7
  })

  it('collapses to the start when the old transcript was empty', () => {
    expect(remapAnchor(0, 0, 100)).toBe(0)
    expect(remapAnchor(10, 0, 100)).toBe(0)
  })

  it('keeps endpoints at the boundaries', () => {
    expect(remapAnchor(0, 80, 120)).toBe(0)
    expect(remapAnchor(80, 80, 120)).toBe(120)
  })
})

describe('charTimeFromMarks', () => {
  // Marks: char 0 → 0s, char 10 → 2s, char 20 → 8s (a slow second half).
  const marks: TtsMark[] = [
    { charOffset: 0, timeSeconds: 0 },
    { charOffset: 10, timeSeconds: 2 },
    { charOffset: 20, timeSeconds: 8 },
  ]

  it('interpolates linearly between bracketing marks', () => {
    expect(charTimeFromMarks(5, marks, 8, 20)).toBe(1) // halfway 0→10 = 1s
    expect(charTimeFromMarks(15, marks, 8, 20)).toBe(5) // halfway 10→20 = 5s
  })

  it('returns a mark time exactly at a mark offset', () => {
    expect(charTimeFromMarks(10, marks, 8, 20)).toBe(2)
  })

  it('tracks pauses/speech-rate, not proportional position', () => {
    // char 15 is 75% through the text but only 62.5% through the audio, because
    // the second half is spoken slower — the whole point of mark-based timing.
    expect(charTimeFromMarks(15, marks, 8, 20)).toBeLessThan((15 / 20) * 8)
  })

  it('anchors before the first / after the last mark to clip start/end', () => {
    const late: TtsMark[] = [{ charOffset: 10, timeSeconds: 4 }]
    expect(charTimeFromMarks(0, late, 8, 20)).toBe(0) // extrapolate from 0
    expect(charTimeFromMarks(20, late, 8, 20)).toBe(8) // extrapolate to end
  })

  it('falls back to the linear proxy when there are no marks', () => {
    expect(charTimeFromMarks(5, [], 8, 20)).toBe((5 / 20) * 8) // 2s
  })

  it('returns 0 for a zero/unknown duration', () => {
    expect(charTimeFromMarks(5, [], 0, 20)).toBe(0)
  })
})
