/**
 * Unit tests for typesetting a formula (TMPL-9 `math` / EDIT-7).
 *
 * In a file of its own rather than among the slot tests: the typesetter and
 * its fonts are a large module, and loading it inside the largest test file in
 * the suite makes every other test there wait for it. Here it is loaded once,
 * by the two tests that need it to be real.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MathTypeset from './MathTypeset'

describe('a formula on a slide', () => {
  it('is typeset, not printed as its source', () => {
    const { container } = render(<MathTypeset tex="E = mc^2" />)
    // An author writes what they know; the audience sees what they mean
    expect(container.querySelector('.katex')).not.toBeNull()
    // And it carries MathML, so a screen reader reads a formula rather than
    // a row of loose symbols
    expect(container.querySelector('math')).not.toBeNull()
  })

  it('shows what it could not parse rather than a blank slot', () => {
    const { container } = render(<MathTypeset tex="\\frac{1}{" />)
    // A formula someone is midway through typing is not an error state, and
    // must never take the slide down with it
    expect(container.textContent).toContain('\\frac{1}{')
  })
})
