/** Unit tests for the narration fingerprint (PLAY-3). */
import { describe, it, expect } from 'vitest'
import { narrationSourceHash } from './translate-narration'
import { slideSourceHash } from './translate-slides'

describe('narrationSourceHash', () => {
  it('is stable for the same words', () => {
    const spoken = 'Today we are talking about photosynthesis.'
    expect(narrationSourceHash(spoken)).toBe(narrationSourceHash(spoken))
  })

  it('changes when the transcript is edited', () => {
    expect(narrationSourceHash('Photosynthesis.')).not.toBe(
      narrationSourceHash('Photosynthesis, roughly.'),
    )
  })

  it('notices whitespace, which the synthesizer hears as pauses', () => {
    expect(narrationSourceHash('One. Two.')).not.toBe(
      narrationSourceHash('One.  Two.'),
    )
  })

  it('distinguishes an empty transcript from a blank one', () => {
    expect(narrationSourceHash('')).not.toBe(narrationSourceHash(' '))
  })

  it('does not collide with the slide-content fingerprint', () => {
    // The two live side by side in one cache entry; if the same words hashed
    // the same either way, an edited slide would look like an edited narration.
    const words = 'Photosynthesis'
    expect(narrationSourceHash(words)).not.toBe(
      slideSourceHash({
        id: 's1',
        slots: { title: { kind: 'text', value: words } },
      }),
    )
  })
})

// That a transcript edit cannot invalidate the slide-content cache needs no
// test: `TranslatableSlide` has no transcript field at all, so `slideSourceHash`
// is structurally incapable of reading one.
