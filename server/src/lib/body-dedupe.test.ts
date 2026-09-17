/**
 * Unit tests for `dropRepeatedBody` (GEN-8): a delta update's body must
 * lose exactly the material already on the slide, and NOTHING else — a
 * bad split (an abbreviation's period reading as a sentence end) must
 * never delete a word, and untouched text must come back byte-for-byte
 * identical to what went in.
 */
import { describe, it, expect } from 'vitest'
import { dropRepeatedBody } from './body-dedupe'

describe('dropRepeatedBody', () => {
  it('is a no-op with no existing body', () => {
    expect(dropRepeatedBody(undefined, 'Anything at all.')).toBe(
      'Anything at all.',
    )
  })

  it('is a no-op with no incoming body', () => {
    expect(dropRepeatedBody('Existing text.', undefined)).toBeUndefined()
  })

  describe('leaves incoming byte-for-byte untouched when nothing matches', () => {
    it('a decimal number', () => {
      const existing = 'We covered basics yesterday in class.'
      const incoming = 'Pi is 3.14159 roughly.'
      expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
    })

    it('a URL and an abbreviation together', () => {
      const existing = 'We covered basics yesterday in class.'
      const incoming =
        'Use a CDN, e.g. Cloudflare, for v2.0 assets at example.com.'
      expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
    })

    it('a shell command', () => {
      const existing = 'We covered basics yesterday in class.'
      const incoming = 'Stage everything with git add .'
      expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
    })

    it('Markdown blank lines and a list', () => {
      const existing = 'We covered basics yesterday in class.'
      const incoming =
        'Here is the plan:\n\n- Step one\n- Step two\n\nThat is all for now.'
      expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
    })

    it('a short existing fragment whose abbreviation period would fire the naive split', () => {
      // "For e.g. speed." only produces sub-3-word, sub-12-char fragments
      // once split at "e.g." and the final period — never substantial, so
      // nothing in it is ever eligible to match, and the new sentence
      // ("Consider e.g. caching.") survives whole.
      const existing = 'For e.g. speed.'
      const incoming = 'Consider e.g. caching.'
      expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
    })

    it('a paraphrase that is not the same sentence', () => {
      const existing = 'We covered arrays in detail yesterday.'
      const incoming = 'We covered arrays and linked lists yesterday too.'
      expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
    })
  })

  it('drops one repeated sentence out of several, keeping the rest exactly', () => {
    const existing = 'We covered functions last week.'
    const incoming = 'We covered functions last week. Today we cover closures.'
    expect(dropRepeatedBody(existing, incoming)).toBe(
      'Today we cover closures.',
    )
  })

  it('drops a repeated sentence embedded in the middle, keeping both sides', () => {
    const existing = 'Photosynthesis converts light into chemical energy.'
    const incoming =
      'Chlorophyll absorbs the light. Photosynthesis converts light into chemical energy. This happens in the chloroplast.'
    expect(dropRepeatedBody(existing, incoming)).toBe(
      'Chlorophyll absorbs the light. This happens in the chloroplast.',
    )
  })

  it('drops the whole body when the incoming text is an exact repeat with no terminator', () => {
    const existing = 'the mitochondria produce energy for the cell'
    const incoming = 'the mitochondria produce energy for the cell'
    expect(dropRepeatedBody(existing, incoming)).toBeUndefined()
  })

  it('treats a case/whitespace variant of the whole body as the same repeat', () => {
    const existing = 'the mitochondria produce energy for the cell'
    const incoming = '  THE   Mitochondria produce energy for the cell  '
    expect(dropRepeatedBody(existing, incoming)).toBeUndefined()
  })

  describe('prefix + remainder with no terminator to anchor a sentence split', () => {
    it('keeps only the new material (English, no punctuation at all)', () => {
      const existing = 'We use caching'
      const incoming = 'We use caching to reduce latency.'
      expect(dropRepeatedBody(existing, incoming)).toBe('to reduce latency.')
    })

    it('keeps only the new material (CJK)', () => {
      const existing = '缓存很有用。'
      const incoming = '缓存很有用。它降低延迟。'
      expect(dropRepeatedBody(existing, incoming)).toBe('它降低延迟。')
    })

    describe('never cuts mid-word or mid-number', () => {
      it('a number that only coincidentally starts with the existing one', () => {
        const existing = 'Supports 5'
        const incoming = 'Supports 50 users.'
        expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
      })

      it('a version number split by the existing text’s own trailing period', () => {
        const existing = 'Version 2.'
        const incoming = 'Version 2.5 adds streaming support.'
        expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
      })

      it('a short existing fragment that only coincidentally opens an unrelated sentence', () => {
        const existing = 'Cache'
        const incoming = 'Cache invalidation is hard.'
        expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
      })

      it('a single-letter existing fragment', () => {
        const existing = 'A'
        const incoming = 'a b c d e f'
        expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
      })
    })
  })

  it('still counts as an update when every incoming sentence is a repeat', () => {
    const existing = 'The mitochondria produce energy for the cell.'
    const incoming = 'The mitochondria produce energy for the cell.'
    expect(dropRepeatedBody(existing, incoming)).toBeUndefined()
  })

  describe('span removal preserves everything else exactly, including in the kept text', () => {
    it('blank lines and a Markdown list survive a real drop', () => {
      const existing = 'Intro paragraph here.'
      const incoming =
        'Intro paragraph here.\n\n- item one here.\n- item two here.'
      expect(dropRepeatedBody(existing, incoming)).toBe(
        '- item one here.\n- item two here.',
      )
    })

    it('a decimal in the kept remainder survives a real drop', () => {
      const existing = 'Intro paragraph here.'
      const incoming = 'Intro paragraph here. See v2.5 for details.'
      expect(dropRepeatedBody(existing, incoming)).toBe('See v2.5 for details.')
    })

    it('a decimal inside a genuinely repeated sentence is dropped as one whole unit, not split', () => {
      // If the sentence split ever fired mid-decimal ("Version 2" / ".5 was
      // released..."), the two halves would be judged separately — one
      // half long enough to count as a "sentence" on its own, the other
      // too short — and only the long half would be recognized as the
      // repeat, leaving the short half stranded in the output.
      const existing = 'Version 2.5 was released last spring.'
      const incoming =
        'The team celebrated the launch. Version 2.5 was released last spring.'
      expect(dropRepeatedBody(existing, incoming)).toBe(
        'The team celebrated the launch.',
      )
    })

    it('preserves blank-line paragraph breaks and a Markdown list around a middle sentence it drops', () => {
      // Goes through the SENTENCE pass (the repeat is not a whole-body
      // prefix — new material precedes it), unlike the two cases above.
      // Spans are joined with `''`, never trimmed-and-rejoined with an
      // invented single space, so the blank line before and after the
      // dropped sentence survives exactly.
      const existing = 'This point already appeared before.'
      const incoming =
        'New heading paragraph starts here.\n\nThis point already appeared before.\n\n- Fresh bullet one\n- Fresh bullet two'
      expect(dropRepeatedBody(existing, incoming)).toBe(
        'New heading paragraph starts here.\n\n- Fresh bullet one\n- Fresh bullet two',
      )
    })
  })

  it('never drops an unrelated short fragment that only coincidentally reads the same after normalizing', () => {
    // Both sides split at "e.g." the same (harmless) way a naive rule
    // would; if short fragments were ever allowed to count as a match on
    // their own, "this." on both sides would collide and " this." would be
    // wrongly deleted from `incoming` even though the two sentences ("See
    // ..." vs "Try ...") are not the same sentence at all.
    const existing = 'See e.g. this.'
    const incoming = 'Try e.g. this.'
    expect(dropRepeatedBody(existing, incoming)).toBe(incoming)
  })
})
