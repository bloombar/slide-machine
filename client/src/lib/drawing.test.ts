import { describe, expect, it } from 'vitest'
import type { Stroke } from '@slide-machine/shared'
import {
  denormalizePoint,
  erasureReplays,
  hitTestStroke,
  nearestSlideToCentroid,
  normalizePoint,
  pointSegmentDistance,
  strokeCentroid,
  strokeVisible,
  type Box,
} from './drawing'

const box: Box = { left: 100, top: 50, width: 800, height: 450 }

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  id: 's1',
  tool: 'pen',
  color: '#000000',
  thickness: 0.01,
  points: [
    { x: 0.2, y: 0.5 },
    { x: 0.8, y: 0.5 },
  ],
  startedAt: '2026-07-21T10:00:00.000Z',
  endedAt: '2026-07-21T10:00:01.000Z',
  anchor: { charAnchor: 0, source: 'appended' },
  ...over,
})

describe('normalize/denormalize round-trip', () => {
  it('maps a client point into 0..1 and back', () => {
    const norm = normalizePoint(500, 275, box)
    expect(norm.x).toBeCloseTo(0.5)
    expect(norm.y).toBeCloseTo(0.5)
    const back = denormalizePoint(norm, box)
    expect(back.x).toBeCloseTo(500)
    expect(back.y).toBeCloseTo(275)
  })

  it('guards a zero-size box', () => {
    expect(
      normalizePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({
      x: 0,
      y: 0,
    })
  })
})

describe('strokeCentroid', () => {
  it('averages the points', () => {
    expect(
      strokeCentroid([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual({ x: 0.5, y: 0.5 })
  })
  it('returns null for no points', () => {
    expect(strokeCentroid([])).toBeNull()
  })
})

describe('pointSegmentDistance', () => {
  it('measures perpendicular distance to a segment', () => {
    expect(pointSegmentDistance(5, 5, 0, 0, 10, 0)).toBe(5)
  })
  it('clamps past the endpoints', () => {
    expect(pointSegmentDistance(-5, 0, 0, 0, 10, 0)).toBe(5)
    expect(pointSegmentDistance(15, 0, 0, 0, 10, 0)).toBe(5)
  })
  it('handles a degenerate (zero-length) segment', () => {
    expect(pointSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('hitTestStroke', () => {
  it('hits a point on the line', () => {
    // midpoint of the horizontal stroke at y=0.5 → client (500, 275)
    expect(hitTestStroke(500, 275, stroke(), box)).toBe(true)
  })

  it('misses a point well away from the line', () => {
    expect(hitTestStroke(500, 400, stroke(), box)).toBe(false)
  })

  it('scales the hit reach with a thicker stroke', () => {
    const near = { clientX: 500, clientY: 289 } // ~14px below the line
    expect(
      hitTestStroke(
        near.clientX,
        near.clientY,
        stroke({ thickness: 0.005 }),
        box,
      ),
    ).toBe(false)
    expect(
      hitTestStroke(
        near.clientX,
        near.clientY,
        stroke({ thickness: 0.08 }),
        box,
      ),
    ).toBe(true)
  })

  it('hits a single-point dot stroke', () => {
    const dot = stroke({ points: [{ x: 0.5, y: 0.5 }] })
    expect(hitTestStroke(500, 275, dot, box)).toBe(true)
    expect(hitTestStroke(700, 275, dot, box)).toBe(false)
  })

  it('returns false for an empty stroke', () => {
    expect(hitTestStroke(500, 275, stroke({ points: [] }), box)).toBe(false)
  })
})

describe('strokeVisible', () => {
  const synced = (over: Partial<Stroke> = {}): Stroke =>
    stroke({ anchor: { charAnchor: 50, source: 'appended' }, ...over })
  const unsynced = (over: Partial<Stroke> = {}): Stroke =>
    stroke({ anchor: { charAnchor: 0, source: 'unsynced' }, ...over })

  it('shows every non-erased stroke outside playback (no progress)', () => {
    expect(strokeVisible(synced(), 0, 100, null)).toBe(true)
    expect(
      strokeVisible(
        synced({ erasedAnchor: { charAnchor: 60, source: 'appended' } }),
        0,
        100,
        null,
      ),
    ).toBe(false)
  })

  it('always shows an unsynced (mic-off) mark, on any slide, in playback', () => {
    // Slide 3 while slide 0 is narrating, fraction 0 — still visible.
    expect(strokeVisible(unsynced(), 3, 100, { index: 0, fraction: 0 })).toBe(
      true,
    )
    // ...and even with no progress at all.
    expect(strokeVisible(unsynced(), 3, 100, null)).toBe(true)
    // Erased unsynced marks hide.
    expect(
      strokeVisible(
        unsynced({ erasedAnchor: { charAnchor: 0, source: 'unsynced' } }),
        3,
        100,
        null,
      ),
    ).toBe(false)
  })

  it('hides a synced stroke on a slide not yet reached', () => {
    expect(strokeVisible(synced(), 2, 100, { index: 0, fraction: 0.5 })).toBe(
      false,
    )
  })

  it('shows a synced stroke on an already-narrated slide', () => {
    expect(strokeVisible(synced(), 0, 100, { index: 2, fraction: 0.1 })).toBe(
      true,
    )
  })

  it('reveals a synced stroke on the active slide by the audio fraction', () => {
    // charAnchor 50 / len 100 = 0.5.
    expect(strokeVisible(synced(), 1, 100, { index: 1, fraction: 0.4 })).toBe(
      false,
    )
    expect(strokeVisible(synced(), 1, 100, { index: 1, fraction: 0.6 })).toBe(
      true,
    )
  })

  it('hides a synced stroke again once playback passes its erase anchor', () => {
    const s = synced({ erasedAnchor: { charAnchor: 80, source: 'appended' } })
    expect(strokeVisible(s, 1, 100, { index: 1, fraction: 0.7 })).toBe(true) // drawn, not yet erased
    expect(strokeVisible(s, 1, 100, { index: 1, fraction: 0.9 })).toBe(false) // erased
  })

  it('hides an orphaned mark throughout playback and on passed slides', () => {
    const orphan = stroke({
      anchor: { charAnchor: 50, source: 'word', orphaned: true },
    })
    // Active slide, fraction well past its anchor — still hidden.
    expect(strokeVisible(orphan, 1, 100, { index: 1, fraction: 1 })).toBe(false)
    // Already-narrated slide — still hidden (would otherwise show).
    expect(strokeVisible(orphan, 0, 100, { index: 2, fraction: 0.1 })).toBe(
      false,
    )
  })

  it('reveals by real mark time, not proportional position, when marks exist', () => {
    // Marks: char 0 → 0s, char 50 → 4s (anchor sits at char 50). At 3s the clock
    // hasn't reached it; at 5s it has — independent of the 0.5 char-fraction.
    const marks = [
      { charOffset: 0, timeSeconds: 0 },
      { charOffset: 50, timeSeconds: 4 },
    ]
    const progress = (currentTime: number) => ({
      index: 1,
      fraction: 1, // fraction would say "shown" — marks must override.
      currentTime,
      duration: 10,
      marks,
    })
    expect(strokeVisible(synced(), 1, 100, progress(3))).toBe(false)
    expect(strokeVisible(synced(), 1, 100, progress(5))).toBe(true)
  })

  describe('under a translated playback (PLAY-3)', () => {
    const playing = { index: 0, fraction: 1 }

    it('does not replay a transcript-timed mark', () => {
      // Its anchor is a position inside the ORIGINAL transcript, and that
      // position means nothing in the words now being spoken — so rather than
      // appear at an arbitrary moment, it does not appear at all.
      expect(
        strokeVisible(synced(), 0, 100, playing, { translated: true }),
      ).toBe(false)
    })

    it('still shows an untimed mark', () => {
      // Marks made mic-off were never tied to speech, so translation costs
      // them nothing.
      expect(
        strokeVisible(unsynced(), 0, 100, playing, { translated: true }),
      ).toBe(true)
    })

    it('shows everything when nothing is playing', () => {
      // Reading a translated deck without narration is unchanged from SHARE-2:
      // the marks are all on the slide, as they are in the original.
      expect(strokeVisible(synced(), 0, 100, null, { translated: true })).toBe(
        true,
      )
      expect(
        strokeVisible(unsynced(), 0, 100, null, { translated: true }),
      ).toBe(true)
    })

    it('leaves an untranslated playback exactly as it was', () => {
      expect(
        strokeVisible(synced(), 0, 100, playing, { translated: false }),
      ).toBe(true)
      expect(strokeVisible(synced(), 0, 100, playing)).toBe(true)
    })
  })
})

describe('erasureReplays', () => {
  const at = (source: Stroke['anchor']['source']) => ({ charAnchor: 5, source })

  it('retains only when the stroke and the erase are both transcript-synced', () => {
    // Both synced (drawn + erased during recording): replay the removal.
    expect(erasureReplays(stroke({ anchor: at('appended') }), at('word'))).toBe(
      true,
    )
    // Unsynced mark (drawn mic-off): always shown, no timeline — delete.
    expect(
      erasureReplays(stroke({ anchor: at('unsynced') }), at('appended')),
    ).toBe(false)
    // Erase made mic-off: no transcript position for the removal — delete.
    expect(erasureReplays(stroke({ anchor: at('word') }), at('unsynced'))).toBe(
      false,
    )
  })
})

describe('nearestSlideToCentroid', () => {
  const slides = [
    { slideId: 'a', box: { left: 0, top: 0, width: 100, height: 100 } },
    { slideId: 'b', box: { left: 0, top: 200, width: 100, height: 100 } },
    { slideId: 'c', box: { left: 0, top: 400, width: 100, height: 100 } },
  ]

  it('picks the slide whose center is closest', () => {
    expect(nearestSlideToCentroid({ x: 50, y: 210 }, slides)).toBe('b')
    expect(nearestSlideToCentroid({ x: 50, y: 30 }, slides)).toBe('a')
    expect(nearestSlideToCentroid({ x: 50, y: 460 }, slides)).toBe('c')
  })

  it('returns null with no candidates', () => {
    expect(nearestSlideToCentroid({ x: 0, y: 0 }, [])).toBeNull()
  })
})
