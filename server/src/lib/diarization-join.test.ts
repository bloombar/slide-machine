/**
 * Unit tests for the diarization time-join: word-level overlap wins, a segment
 * spanning a speaker change goes to its majority speaker, the range fallback
 * applies without words, and non-overlapping / untimed segments stay untagged.
 */
import { describe, it, expect } from 'vitest'
import { assignSpeakers, type JoinableSegment } from './diarization-join'
import type { DiarizedSpeakerSegment } from '@slide-machine/shared'

const word = (startMs: number, endMs: number) => ({ word: 'w', startMs, endMs })

const diarized: DiarizedSpeakerSegment[] = [
  { speaker: 1, startMs: 0, endMs: 1000 },
  { speaker: 2, startMs: 1000, endMs: 5000 },
]

describe('assignSpeakers', () => {
  it('assigns a segment to the speaker its words overlap', () => {
    const segs: JoinableSegment[] = [
      { id: 'a', words: [word(0, 400), word(400, 900)] }, // all in speaker 1
      { id: 'b', words: [word(1200, 1600), word(1600, 2000)] }, // speaker 2
    ]
    const out = assignSpeakers(segs, diarized)
    expect(out.get('a')).toBe(1)
    expect(out.get('b')).toBe(2)
  })

  it('gives a boundary-spanning segment to its majority speaker', () => {
    // 100 ms in speaker 1, 900 ms in speaker 2 → speaker 2 wins.
    const segs: JoinableSegment[] = [
      { id: 'x', words: [word(900, 1000), word(1000, 1900)] },
    ]
    expect(assignSpeakers(segs, diarized).get('x')).toBe(2)
  })

  it('falls back to the segment range when there are no words', () => {
    const segs: JoinableSegment[] = [{ id: 'r', startMs: 100, endMs: 900 }]
    expect(assignSpeakers(segs, diarized).get('r')).toBe(1)
  })

  it('leaves untimed or non-overlapping segments untagged', () => {
    const segs: JoinableSegment[] = [
      { id: 'untimed', text: 'hi' } as JoinableSegment,
      { id: 'far', startMs: 9000, endMs: 9500 },
    ]
    const out = assignSpeakers(segs, diarized)
    expect(out.has('untimed')).toBe(false)
    expect(out.has('far')).toBe(false)
  })

  it('returns nothing when there is no diarization', () => {
    expect(assignSpeakers([{ id: 'a', startMs: 0, endMs: 10 }], []).size).toBe(
      0,
    )
  })

  it('breaks an exact overlap tie toward the lowest speaker id', () => {
    const even: DiarizedSpeakerSegment[] = [
      { speaker: 2, startMs: 0, endMs: 500 },
      { speaker: 1, startMs: 500, endMs: 1000 },
    ]
    // 500 ms each → tie → lowest id (1).
    const segs: JoinableSegment[] = [{ id: 't', startMs: 0, endMs: 1000 }]
    expect(assignSpeakers(segs, even).get('t')).toBe(1)
  })
})
