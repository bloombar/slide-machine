/**
 * Unit tests for arrow-key navigation: fires callbacks, ignores typing.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { useArrowKeys } from './useArrowKeys'

function Harness({
  onPrev,
  onNext,
}: {
  onPrev: () => void
  onNext: () => void
}) {
  useArrowKeys(onPrev, onNext)
  return <input aria-label="typing field" />
}

describe('useArrowKeys', () => {
  it('maps ArrowLeft/ArrowRight to prev/next', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Harness onPrev={onPrev} onNext={onNext} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(onNext).toHaveBeenCalledTimes(2)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('ignores arrows while typing in an input', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Harness onPrev={onPrev} onNext={onNext} />)

    fireEvent.keyDown(screen.getByLabelText('typing field'), {
      key: 'ArrowRight',
    })
    fireEvent.keyDown(screen.getByLabelText('typing field'), {
      key: 'ArrowLeft',
    })

    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('ignores unrelated keys', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Harness onPrev={onPrev} onNext={onNext} />)

    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'a' })

    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })
})
