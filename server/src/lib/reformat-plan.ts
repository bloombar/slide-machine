/**
 * Reformat planning (GEN-4 Phase 4). Decides, per slide, whether the
 * post-lecture reformat should regenerate it — the "hybrid" policy: regenerate
 * only slides that mixed in student speech (so a student's question isn't left
 * standing as authoritative fact), and PROTECT the rest. Pure and deterministic.
 */
import type { SpeakerRole } from '@slide-machine/shared'

export type ReformatDecision = 'keep' | 'reformat' | 'protected'

export interface SlideReformatPlan {
  slideId: string
  decision: ReformatDecision
  /** Why — for logging and the run summary. */
  reason: 'lecturer-only' | 'has-student' | 'manually-edited' | 'no-transcript'
}

/** The slide fields the plan needs. */
export interface PlannableSlide {
  id: string
  manuallyEdited?: boolean
}

/**
 * Plans each slide's fate from its transcript segments' roles:
 * - hand-edited → `protected` (never clobber a user's edit),
 * - no backing segments → `protected` (manually-added / unlinked slide),
 * - any student turn → `reformat` (student content needs reframing),
 * - otherwise (lecturer-only) → `keep`.
 *
 * `rolesBySlide` maps slideId → the roles of the segments linked to it.
 */
export const planReformat = (
  slides: PlannableSlide[],
  rolesBySlide: Map<string, SpeakerRole[]>,
): SlideReformatPlan[] =>
  slides.map(slide => {
    if (slide.manuallyEdited)
      return {
        slideId: slide.id,
        decision: 'protected',
        reason: 'manually-edited',
      }

    const roles = rolesBySlide.get(slide.id) ?? []
    if (!roles.length)
      return {
        slideId: slide.id,
        decision: 'protected',
        reason: 'no-transcript',
      }

    if (roles.includes('student'))
      return { slideId: slide.id, decision: 'reformat', reason: 'has-student' }

    return { slideId: slide.id, decision: 'keep', reason: 'lecturer-only' }
  })
