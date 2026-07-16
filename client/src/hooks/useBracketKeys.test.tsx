/**
 * Unit tests for bracket-key layout cycling: "]" next, "[" previous, and
 * the typing-target guard so brackets typed into a field are ignored.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useBracketKeys } from './useBracketKeys'

function Harness({
  onPrev,
  onNext,
}: {
  onPrev: () => void
  onNext: () => void
}) {
  useBracketKeys(onPrev, onNext)
  return <input data-testid="field" />
}

describe('useBracketKeys', () => {
  it('cycles next on "]" and previous on "["', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Harness onPrev={onPrev} onNext={onNext} />)

    fireEvent.keyDown(window, { key: ']' })
    expect(onNext).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: '[' })
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Harness onPrev={onPrev} onNext={onNext} />)
    fireEvent.keyDown(window, { key: 'a' })
    expect(onPrev).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('does not fire while typing in a field', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Harness onPrev={onPrev} onNext={onNext} />)
    // target is the input, so the keypress is a bracket typed into text
    fireEvent.keyDown(screen.getByTestId('field'), { key: ']' })
    expect(onNext).not.toHaveBeenCalled()
  })
})
