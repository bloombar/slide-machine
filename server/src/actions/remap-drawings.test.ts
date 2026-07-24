/**
 * Unit tests for semantic stroke re-anchoring across a transcript rewrite. Uses
 * the mock provider's deterministic bag-of-words embedding (shared-word overlap
 * → higher cosine), so a reworded phrase that keeps its key nouns re-binds while
 * a deleted phrase orphans.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Stroke } from '@slide-machine/shared'
import { MockGenerationProvider } from '../providers/mock-generation'
import { remapDrawingAnchors } from './remap-drawings'

const gen = new MockGenerationProvider()
const embed = (texts: string[]) => gen.embedTexts(texts)

const stroke = (over: Partial<Stroke['anchor']>): Stroke => ({
  id: 'x',
  tool: 'pen',
  color: '#000',
  thickness: 0.01,
  points: [{ x: 0, y: 0 }],
  startedAt: '',
  endedAt: '',
  anchor: { charAnchor: 0, source: 'word', ...over },
})

describe('remapDrawingAnchors', () => {
  it('re-binds a fingerprinted mark to the reworded equivalent phrase', async () => {
    // New transcript: the mitochondria idea moved to the SECOND sentence.
    const oldText = 'The mitochondria is the powerhouse of the cell.'
    const newText =
      'Cells need energy to function. The mitochondria powers the cell.'
    const marks = [
      stroke({
        charAnchor: 4,
        phraseText: 'The mitochondria is the powerhouse of the cell.',
        phraseOffset: 0.1,
      }),
    ]
    const [out] = await remapDrawingAnchors(marks, oldText, newText, embed)
    // Re-anchored into the second sentence (starts at char 31), not proportional.
    const secondStart = newText.indexOf('The mitochondria powers')
    expect(out!.anchor.orphaned).toBe(false)
    expect(out!.anchor.charAnchor).toBeGreaterThanOrEqual(secondStart)
  })

  it('orphans a mark whose phrase was removed', async () => {
    const oldText = 'Photosynthesis converts sunlight. The cell divides.'
    const newText = 'The cell divides into two daughter cells.'
    const marks = [
      stroke({
        charAnchor: 0,
        phraseText: 'Photosynthesis converts sunlight.',
        phraseOffset: 0,
      }),
    ]
    const [out] = await remapDrawingAnchors(marks, oldText, newText, embed)
    expect(out!.anchor.orphaned).toBe(true)
  })

  it('falls back to proportional for marks without a fingerprint', async () => {
    const marks = [stroke({ charAnchor: 50, source: 'appended' })]
    const [out] = await remapDrawingAnchors(
      marks,
      'x'.repeat(100),
      'y'.repeat(200),
      embed,
    )
    expect(out!.anchor.charAnchor).toBe(100) // 50/100 * 200
    expect(out!.anchor.orphaned).toBeUndefined()
  })

  it('falls back to proportional for every mark when embeddings throw', async () => {
    const failing = vi.fn(async () => {
      throw new Error('embeddings down')
    })
    const marks = [
      stroke({
        charAnchor: 25,
        phraseText: 'some phrase here',
        phraseOffset: 0,
      }),
    ]
    const [out] = await remapDrawingAnchors(
      marks,
      'x'.repeat(100),
      'y'.repeat(50),
      failing,
    )
    expect(out!.anchor.charAnchor).toBe(13) // round(25/100 * 50)
    expect(out!.anchor.orphaned).toBeUndefined()
  })

  it('remaps the erase anchor too', async () => {
    const oldText = 'Alpha beta gamma. Delta epsilon zeta.'
    const newText = 'Delta epsilon zeta rules. Alpha beta gamma follows.'
    const marks = [
      {
        ...stroke({
          charAnchor: 0,
          phraseText: 'Alpha beta gamma.',
          phraseOffset: 0,
        }),
        erasedAnchor: {
          charAnchor: 18,
          source: 'word' as const,
          phraseText: 'Delta epsilon zeta.',
          phraseOffset: 0,
        },
      },
    ]
    const [out] = await remapDrawingAnchors(marks, oldText, newText, embed)
    // Draw re-binds to the "Alpha beta gamma" sentence (now second), erase to
    // the "Delta epsilon zeta" sentence (now first).
    expect(out!.anchor.charAnchor).toBeGreaterThan(
      out!.erasedAnchor!.charAnchor,
    )
  })
})
