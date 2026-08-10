/**
 * Unit tests for typesetting a formula into a picture (EXP-7).
 *
 * The requirement is absolute — "a formula must never export as its LaTeX
 * source" — so the two things worth holding this to are that a formula does
 * become a picture, and that one which cannot says so instead of producing a
 * picture of an error message. Silence is what lets the caller report it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetFormulaCache, typesetFormula } from './math-render'

const INK = '#1c2230'

beforeEach(() => resetFormulaCache())

describe('a formula', () => {
  it('becomes a picture', async () => {
    const drawn = await typesetFormula('E = mc^2', INK)
    expect(drawn).not.toBeNull()
    // PNG magic: what both exporters can place
    expect(Array.from(drawn!.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('reports its proportions, so nothing stretches it', async () => {
    // A formula is usually far wider than it is tall; filling its box would
    // distort the notation
    const wide = await typesetFormula('a = b + c + d + e + f', INK)
    const tall = await typesetFormula('\\frac{a}{b}', INK)
    expect(wide!.aspect).toBeGreaterThan(tall!.aspect)
  })

  it('is drawn in the colour it is asked for', async () => {
    // MathJax paints in `currentColor`, which means nothing to a rasterizer
    // with no document around it — left alone, every formula on a dark
    // template would come out black
    const light = await typesetFormula('x', '#ffffff')
    const dark = await typesetFormula('x', '#000000')
    expect(Buffer.from(light!.png).equals(Buffer.from(dark!.png))).toBe(false)
  })

  it('typesets the same formula once', async () => {
    const first = await typesetFormula('\\int_0^1 x\\,dx', INK)
    const second = await typesetFormula('\\int_0^1 x\\,dx', INK)
    // Not merely equal: the cached object itself
    expect(second).toBe(first)
  })
})

describe('a formula that will not typeset', () => {
  it('is nothing, rather than a picture of an error', async () => {
    // MathJax renders its complaint as notation; a slide reading "Undefined
    // control sequence" is not what the author meant
    expect(await typesetFormula('\\frac{1}{', INK)).toBeNull()
    expect(await typesetFormula('\\notacommand', INK)).toBeNull()
  })

  it('is nothing for an empty box', async () => {
    expect(await typesetFormula('   ', INK)).toBeNull()
  })
})
