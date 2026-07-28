/**
 * Unit tests for reformat planning: student-mixed slides are reformatted;
 * lecturer-only slides kept; hand-edited and un-backed (manually-added) slides
 * protected. Provenance wins over role composition.
 */
import { describe, it, expect } from 'vitest'
import { planReformat } from './reformat-plan'
import type { SpeakerRole } from '@slide-machine/shared'

const roles = (m: Record<string, SpeakerRole[]>) => new Map(Object.entries(m))

describe('planReformat', () => {
  it('reformats a slide that contains any student turn', () => {
    const plan = planReformat(
      [{ id: 's1' }],
      roles({ s1: ['lecturer', 'student', 'lecturer'] }),
    )
    expect(plan[0]).toMatchObject({
      decision: 'reformat',
      reason: 'has-student',
    })
  })

  it('keeps a lecturer-only slide', () => {
    const plan = planReformat(
      [{ id: 's1' }],
      roles({ s1: ['lecturer', 'lecturer'] }),
    )
    expect(plan[0]).toMatchObject({ decision: 'keep', reason: 'lecturer-only' })
  })

  it('protects a hand-edited slide even if it has student turns', () => {
    const plan = planReformat(
      [{ id: 's1', manuallyEdited: true }],
      roles({ s1: ['student'] }),
    )
    expect(plan[0]).toMatchObject({
      decision: 'protected',
      reason: 'manually-edited',
    })
  })

  it('protects a slide with no backing segments (manually added)', () => {
    const plan = planReformat([{ id: 's1' }], roles({}))
    expect(plan[0]).toMatchObject({
      decision: 'protected',
      reason: 'no-transcript',
    })
  })

  it('plans each slide independently', () => {
    const plan = planReformat(
      [{ id: 'a' }, { id: 'b' }, { id: 'c', manuallyEdited: true }],
      roles({ a: ['lecturer'], b: ['lecturer', 'student'], c: ['lecturer'] }),
    )
    expect(plan.map(p => p.decision)).toEqual(['keep', 'reformat', 'protected'])
  })
})
