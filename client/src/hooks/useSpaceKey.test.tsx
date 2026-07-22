/**
 * Unit tests for the Space-bar narration toggle: Space fires the toggle, other
 * keys don't, the typing-target guard ignores a space typed into a field, and
 * the listener is inert (Space keeps its default) when disabled.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSpaceKey } from './useSpaceKey'

function Harness({
  onToggle,
  enabled = true,
}: {
  onToggle: () => void
  enabled?: boolean
}) {
  useSpaceKey(onToggle, enabled)
  return <input data-testid="field" />
}

describe('useSpaceKey', () => {
  it('toggles on Space and prevents the default (scroll/re-click)', () => {
    const onToggle = vi.fn()
    render(<Harness onToggle={onToggle} />)

    const prevented = !fireEvent.keyDown(window, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
  })

  it('ignores other keys', () => {
    const onToggle = vi.fn()
    render(<Harness onToggle={onToggle} />)
    fireEvent.keyDown(window, { key: 'a' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('does not fire while typing in a field', () => {
    const onToggle = vi.fn()
    render(<Harness onToggle={onToggle} />)
    // A space typed into the input must not toggle playback.
    fireEvent.keyDown(screen.getByTestId('field'), { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const onToggle = vi.fn()
    render(<Harness onToggle={onToggle} enabled={false} />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('always calls the latest callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Harness onToggle={first} />)
    rerender(<Harness onToggle={second} />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
