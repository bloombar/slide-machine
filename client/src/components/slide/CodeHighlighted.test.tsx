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

describe('a listing too wide for its box', () => {
  const sizeOf = (el: Element | null) =>
    Number(/([\d.]+)cqi/.exec((el as HTMLElement).style.fontSize)?.[1])

  it('shrinks to fit rather than being clipped', () => {
    // A listing is never reflowed — its line breaks are the author's — so
    // what gives is the type size. A slide that cuts its code off at both
    // edges shows nobody anything.
    const short = render(<CodeHighlighted source="x = 1" language="python" />)
    const long = render(
      <CodeHighlighted source={`x = "${'y'.repeat(200)}"`} language="python" />,
    )
    expect(sizeOf(long.container.querySelector('pre'))).toBeLessThan(
      sizeOf(short.container.querySelector('pre')),
    )
  })

  it('stops shrinking before it becomes unreadable', () => {
    const { container } = render(
      <CodeHighlighted source={'z'.repeat(5000)} language="python" />,
    )
    expect(sizeOf(container.querySelector('pre'))).toBeGreaterThanOrEqual(0.9)
  })

  it('leaves an ordinary listing at full size', () => {
    const { container } = render(
      <CodeHighlighted source={'def f():\n    return 1'} language="python" />,
    )
    expect(sizeOf(container.querySelector('pre'))).toBe(2)
  })
})
