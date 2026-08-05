/**
 * Tests for the slide fingerprint that drives translation-cache staleness
 * (SHARE-2). The read-through caching itself needs a database and is covered
 * in test/integration/translation.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { slideSourceHash } from './translate-slides'

const slide = {
  id: 's1',
  title: 'Title',
  body: 'Body',
  bullets: ['one', 'two'],
  caption: 'Caption',
}

describe('slideSourceHash', () => {
  it('is stable for unchanged content', () => {
    expect(slideSourceHash(slide)).toBe(slideSourceHash({ ...slide }))
  })

  it('ignores the slide id, so two identical slides share a fingerprint', () => {
    expect(slideSourceHash({ ...slide, id: 's2' })).toBe(slideSourceHash(slide))
  })

  it.each([
    ['title', { title: 'Changed' }],
    ['body', { body: 'Changed' }],
    ['a bullet', { bullets: ['one', 'changed'] }],
    ['bullet order', { bullets: ['two', 'one'] }],
    ['a removed bullet', { bullets: ['one'] }],
    ['caption', { caption: 'Changed' }],
  ])('changes when %s changes', (_name, patch) => {
    expect(slideSourceHash({ ...slide, ...patch })).not.toBe(
      slideSourceHash(slide),
    )
  })

  it('does not change when untranslated fields change', () => {
    // Editing the image or the spoken transcript must not cost a re-translation
    const unrelated = {
      ...slide,
      imageRef: 'new.png',
      sourceTranscript: 'different narration',
      layoutType: 'two-column',
    }
    expect(slideSourceHash(unrelated)).toBe(slideSourceHash(slide))
  })

  it('treats an absent field and an empty one alike', () => {
    const bare = { id: 's1' }
    expect(slideSourceHash(bare)).toBe(
      slideSourceHash({ id: 's1', title: '', body: '', caption: '' }),
    )
  })

  it('distinguishes text moving between fields', () => {
    expect(slideSourceHash({ id: 's1', title: 'x' })).not.toBe(
      slideSourceHash({ id: 's1', body: 'x' }),
    )
  })
})
