/**
 * Unit tests for highlighting a program listing (TMPL-9 `code` / EDIT-7).
 *
 * In a file of its own for the same reason the typesetter's tests are: sixteen
 * grammars are a large module, and the slot tests should not wait for them.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CodeHighlighted from './CodeHighlighted'

describe('a program listing on a slide', () => {
  it('is highlighted for the language it declares', () => {
    const { container } = render(
      <CodeHighlighted source="def f():\n    return 1" language="python" />,
    )
    expect(container.querySelector('.hljs-keyword')).not.toBeNull()
    expect(container.querySelector('pre')).toHaveAttribute(
      'data-language',
      'python',
    )
  })

  it('keeps the author’s indentation exactly', () => {
    const source = 'def f():\n    if x:\n        return 1'
    const { container } = render(
      <CodeHighlighted source={source} language="python" />,
    )
    // A listing whose leading spaces were normalized is a different program
    expect(container.querySelector('code')!.textContent).toBe(source)
  })

  it('shows a listing plainly when we have no grammar for it', () => {
    const { container } = render(
      <CodeHighlighted source=">:#,_@" language="befunge" />,
    )
    // Exactly as readable, merely less colourful
    expect(container.textContent).toContain('>:#,_@')
    expect(container.querySelector('.hljs-keyword')).toBeNull()
  })

  it('follows the name an author is likely to have typed', () => {
    const { container } = render(
      <CodeHighlighted source="const x = 1" language="JS" />,
    )
    expect(container.querySelector('pre')).toHaveAttribute(
      'data-language',
      'javascript',
    )
  })
})
