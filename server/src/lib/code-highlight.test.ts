/**
 * Unit tests for colouring a listing on its way out (EXP-7).
 *
 * The property that matters most is not the colours: it is that the pieces
 * put back together are the listing that went in, character for character.
 * A highlighter that drops a space has changed the program.
 */
import { describe, it, expect } from 'vitest'
import { codeColor, highlightCode } from './code-highlight'

const rejoin = (source: string, language?: string) =>
  highlightCode(source, language)
    .map(span => span.text)
    .join('')

describe('a listing broken into coloured pieces', () => {
  it('comes back together as exactly what went in', () => {
    const source = 'def add(a, b):\n    # sum them\n    return a + b\n'
    expect(rejoin(source, 'python')).toBe(source)
  })

  it('keeps characters the markup had to escape', () => {
    // `<`, `>` and `&` travel through HTML as entities; a listing that came
    // back with `&lt;` in it would no longer compile
    const source = 'if (a < b && c > d) { x = "y"; }'
    expect(rejoin(source, 'javascript')).toBe(source)
  })

  it('keeps every leading space', () => {
    const source = 'def f():\n        return 1'
    expect(rejoin(source, 'python')).toContain('        return')
  })

  it('marks what each piece is', () => {
    const spans = highlightCode('return 1', 'python')
    expect(spans.find(s => s.text === 'return')?.token).toBe('keyword')
  })

  it('joins neighbouring pieces of the same kind', () => {
    // Fewer runs for the exporters to place, and identical output
    const spans = highlightCode('a + b', 'python')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.token).toBeUndefined()
  })

  it('hands back a listing whole when we have no grammar for it', () => {
    expect(highlightCode('>:#,_@', 'befunge')).toEqual([{ text: '>:#,_@' }])
  })

  it('hands back a listing whole when no language was declared', () => {
    expect(highlightCode('x = 1')).toEqual([{ text: 'x = 1' }])
  })

  it('follows the name an author is likely to have typed', () => {
    expect(highlightCode('const x = 1', 'JS')[0]?.token).toBe('keyword')
  })

  it('has nothing to say about nothing', () => {
    expect(highlightCode('', 'python')).toEqual([])
  })
})

describe('the colour a token is drawn in', () => {
  it('is chosen against the background it will sit on', () => {
    // A comment grey that reads on white disappears on navy
    const onDark = codeColor('comment', '#0f172a')
    const onLight = codeColor('comment', '#ffffff')
    expect(onDark).toBeDefined()
    expect(onLight).toBeDefined()
    expect(onDark).not.toBe(onLight)
  })

  it('is nothing for ordinary code, which takes the slide’s own colour', () => {
    expect(codeColor(undefined, '#ffffff')).toBeUndefined()
  })

  it('is nothing for a token kind we have no colour for', () => {
    // The grammar knows something we do not; a guess would be worse than the
    // slide's own text colour
    expect(codeColor('subst', '#ffffff')).toBeUndefined()
  })

  it('falls back to the light palette when the background is unreadable', () => {
    expect(codeColor('keyword', 'not-a-colour')).toBe(
      codeColor('keyword', '#ffffff'),
    )
  })
})
