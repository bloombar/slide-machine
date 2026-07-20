/**
 * Unit tests for speaker → role mapping: the top talker is the lecturer, the
 * rest are students, ties favor the lowest speaker id, and empty input is safe.
 */
import { describe, it, expect } from 'vitest'
import { mapSpeakerRoles } from './speaker-roles'
import type { DiarizedSpeakerSegment } from '@slide-machine/shared'

describe('mapSpeakerRoles', () => {
  it('marks a lone speaker as the lecturer', () => {
    const roles = mapSpeakerRoles([{ speaker: 1, startMs: 0, endMs: 5000 }])
    expect(roles.get(1)).toBe('lecturer')
  })

  it('makes the top talker the lecturer and the rest students', () => {
    const diarized: DiarizedSpeakerSegment[] = [
      { speaker: 1, startMs: 0, endMs: 8000 }, // 8 s — most
      { speaker: 2, startMs: 8000, endMs: 9000 }, // 1 s
      { speaker: 3, startMs: 9000, endMs: 9500 }, // 0.5 s
    ]
    const roles = mapSpeakerRoles(diarized)
    expect(roles.get(1)).toBe('lecturer')
    expect(roles.get(2)).toBe('student')
    expect(roles.get(3)).toBe('student')
  })

  it('sums each speaker across intervals before comparing', () => {
    const diarized: DiarizedSpeakerSegment[] = [
      { speaker: 1, startMs: 0, endMs: 1000 },
      { speaker: 2, startMs: 1000, endMs: 3000 }, // 2 s in one go
      { speaker: 1, startMs: 3000, endMs: 6000 }, // 1 + 3 = 4 s total → lecturer
    ]
    const roles = mapSpeakerRoles(diarized)
    expect(roles.get(1)).toBe('lecturer')
    expect(roles.get(2)).toBe('student')
  })

  it('breaks a talk-time tie toward the lowest speaker id', () => {
    const roles = mapSpeakerRoles([
      { speaker: 2, startMs: 0, endMs: 1000 },
      { speaker: 1, startMs: 1000, endMs: 2000 },
    ])
    expect(roles.get(1)).toBe('lecturer')
    expect(roles.get(2)).toBe('student')
  })

  it('returns an empty map for no input', () => {
    expect(mapSpeakerRoles([]).size).toBe(0)
  })
})
