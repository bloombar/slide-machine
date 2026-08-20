/**
 * Unit tests for the mid-speech interim flush (GEN-12): stable-prefix
 * detection, the word threshold, final-remainder dedupe, and reset.
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
    expect(flusher.interim(sentence(6))).toBe(sentence(6))
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
    expect(flusher.interim('one two REVISED four five six')).toBe(
      'one two REVISED four five',
    )
  })

  it('flushes repeatedly as speech keeps growing, without resubmitting', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim(sentence(3))
    expect(flusher.interim(sentence(3))).toBe(sentence(3))
    // Three more words arrive and stabilize.
    expect(flusher.interim(sentence(6))).toBeNull()
    expect(flusher.interim(sentence(6))).toBe('w4 w5 w6')
  })

  it('final returns only the unflushed remainder and the flushed count', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim(sentence(4))
    expect(flusher.interim(sentence(4))).toBe(sentence(4))
    expect(flusher.final(sentence(6))).toEqual({
      text: 'w5 w6',
      flushed: 4,
    })
  })

  it('final returns everything when nothing was flushed', () => {
    const flusher = createInterimFlusher(10)
    flusher.interim('a short remark')
    flusher.interim('a short remark')
    expect(flusher.final('a short remark indeed')).toEqual({
      text: 'a short remark indeed',
      flushed: 0,
    })
  })

  it('final returns empty text when every word was already flushed', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(4))
    expect(flusher.interim(sentence(4))).toBe(sentence(4))
    expect(flusher.final(sentence(4))).toEqual({ text: '', flushed: 4 })
  })

  it('final returns empty text when the recognizer revised the utterance shorter than what was flushed', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(5))
    expect(flusher.interim(sentence(5))).toBe(sentence(5))
    expect(flusher.final(sentence(3))).toEqual({ text: '', flushed: 5 })
  })

  it('final resets state for the next utterance', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(3))
    expect(flusher.interim(sentence(3))).toBe(sentence(3))
    flusher.final(sentence(3))
    // A new utterance starts from scratch: first update is never stable.
    expect(flusher.interim(sentence(10))).toBeNull()
    expect(flusher.interim(sentence(10))).toBe(sentence(10))
  })

  it('reset drops per-utterance state', () => {
    const flusher = createInterimFlusher(2)
    flusher.interim(sentence(5))
    flusher.reset()
    expect(flusher.interim(sentence(5))).toBeNull()
    expect(flusher.final(sentence(5))).toEqual({
      text: sentence(5),
      flushed: 0,
    })
  })

  it('normalizes irregular whitespace when counting words', () => {
    const flusher = createInterimFlusher(3)
    flusher.interim('  one   two\tthree ')
    expect(flusher.interim('one two three')).toBe('one two three')
  })
})
