/**
 * Unit tests for the mid-speech interim flush (GEN-12): stable-prefix
 * detection, the word threshold, final-remainder dedupe, reset, and the
 * finalized-wording corrections `final()` pairs with each earlier flush.
 */
import { describe, it, expect } from 'vitest'
import { createInterimFlusher } from './interim-flush'

/** A sentence of `n` distinct words ("w1 w2 … wn"). */
const sentence = (n: number, from = 1): string =>
  Array.from({ length: n }, (_, i) => `w${from + i}`).join(' ')

describe('createInterimFlusher', () => {
  it('never flushes on the first interim update (nothing is stable yet)', () => {
    const flusher = createInterimFlusher(3)
    expect(flusher.interim(sentence(50))).toBeNull()
  })

  it('flushes the stable prefix once it reaches the threshold', () => {
    const flusher = createInterimFlusher(5)
    expect(flusher.interim(sentence(6))).toBeNull()
    // The second update repeats the words, making all six stable.
    expect(flusher.interim(sentence(6))).toEqual({ text: sentence(6), seq: 0 })
  })

  it('holds below the threshold', () => {
    const flusher = createInterimFlusher(5)
    expect(flusher.interim(sentence(4))).toBeNull()
    expect(flusher.interim(sentence(4))).toBeNull()
  })

  it('only counts words unchanged across consecutive updates as stable', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim('one two three four')
    // The tail was revised: only "one two" is stable — below threshold.
    expect(flusher.interim('one two REVISED four five')).toBeNull()
    // Now the first five words agree — over threshold, all five flush.
    expect(flusher.interim('one two REVISED four five six')).toEqual({
      text: 'one two REVISED four five',
      seq: 0,
    })
  })

  it('flushes repeatedly as speech keeps growing, without resubmitting', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim(sentence(3))
    expect(flusher.interim(sentence(3))).toEqual({ text: sentence(3), seq: 0 })
    // Three more words arrive and stabilize.
    expect(flusher.interim(sentence(6))).toBeNull()
    // Each flush gets the next seq in submission order.
    expect(flusher.interim(sentence(6))).toEqual({ text: 'w4 w5 w6', seq: 1 })
  })

  it('final returns only the unflushed remainder, the flushed count, and an unchanged correction', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim(sentence(4))
    expect(flusher.interim(sentence(4))).toEqual({ text: sentence(4), seq: 0 })
    // The recognizer didn't revise the flushed words, so `final` equals
    // `submitted` — callers know to skip this entry.
    expect(flusher.final(sentence(6))).toEqual({
      text: 'w5 w6',
      flushed: 4,
      corrections: [{ seq: 0, submitted: sentence(4), final: sentence(4) }],
    })
  })

  it('final returns everything when nothing was flushed', () => {
    const flusher = createInterimFlusher(10)
    flusher.interim('a short remark')
    flusher.interim('a short remark')
    expect(flusher.final('a short remark indeed')).toEqual({
      text: 'a short remark indeed',
      flushed: 0,
      corrections: [],
    })
  })

  it('final returns empty text when every word was already flushed', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(4))
    expect(flusher.interim(sentence(4))).toEqual({ text: sentence(4), seq: 0 })
    expect(flusher.final(sentence(4))).toEqual({
      text: '',
      flushed: 4,
      corrections: [{ seq: 0, submitted: sentence(4), final: sentence(4) }],
    })
  })

  it('final returns empty text when the recognizer revised the utterance shorter than what was flushed', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(5))
    expect(flusher.interim(sentence(5))).toEqual({ text: sentence(5), seq: 0 })
    // The finalized utterance only has three words — the flush's word range
    // is clamped to what's actually there, and it no longer matches what was
    // submitted: a real correction.
    expect(flusher.final(sentence(3))).toEqual({
      text: '',
      flushed: 5,
      corrections: [{ seq: 0, submitted: sentence(5), final: sentence(3) }],
    })
  })

  it("final's corrections carry the finalized wording only for a flush the recognizer actually revised", () => {
    const flusher = createInterimFlusher(2)
    // First flush: "a b" (unrevised by the finalized text below).
    flusher.interim('a b')
    expect(flusher.interim('a b c d')).toEqual({ text: 'a b', seq: 0 })
    // Second flush: "c d" and "d" was already stable from the update above,
    // so this single update is enough to clear the threshold again — the
    // recognizer later revises "c" to "X".
    expect(flusher.interim('a b c d e f')).toEqual({ text: 'c d', seq: 1 })
    const result = flusher.final('a b X d e f g')
    expect(result.text).toBe('e f g')
    expect(result.flushed).toBe(4)
    expect(result.corrections).toEqual([
      // seq 0's words are unchanged — same text either side.
      { seq: 0, submitted: 'a b', final: 'a b' },
      // seq 1's first word was revised — the slide it landed on needs fixing.
      { seq: 1, submitted: 'c d', final: 'X d' },
    ])
  })

  it('final resets state for the next utterance', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(3))
    expect(flusher.interim(sentence(3))).toEqual({ text: sentence(3), seq: 0 })
    flusher.final(sentence(3))
    // A new utterance starts from scratch: first update is never stable, and
    // seq numbering restarts too.
    expect(flusher.interim(sentence(10))).toBeNull()
    expect(flusher.interim(sentence(10))).toEqual({
      text: sentence(10),
      seq: 0,
    })
  })

  it('reset drops per-utterance state', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(5))
    flusher.reset()
    expect(flusher.interim(sentence(5))).toBeNull()
    expect(flusher.final(sentence(5))).toEqual({
      text: sentence(5),
      flushed: 0,
      corrections: [],
    })
  })

  it('normalizes irregular whitespace when counting words', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim('  one   two\tthree ')
    expect(flusher.interim('one two three')).toEqual({
      text: 'one two three',
      seq: 0,
    })
  })
})
