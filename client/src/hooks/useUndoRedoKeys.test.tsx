/**
 * Unit tests for the whiteboard undo/redo keyboard hook: which key
 * combinations map to undo vs redo, the typing-field and enabled guards, and
 * that native undo is only suppressed when an edit was actually reversed.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useUndoRedoKeys } from './useUndoRedoKeys'

function Harness({
  onUndo,
  onRedo,
  enabled = true,
}: {
  onUndo: () => boolean
  onRedo: () => boolean
  enabled?: boolean
}) {
  useUndoRedoKeys(onUndo, onRedo, enabled)
  return (
    <div>
      <input aria-label="field" />
    </div>
  )
}

let onUndo: Mock<() => boolean>
let onRedo: Mock<() => boolean>

beforeEach(() => {
  onUndo = vi.fn<() => boolean>(() => true)
  onRedo = vi.fn<() => boolean>(() => true)
})

describe('useUndoRedoKeys', () => {
  it('undoes on Cmd/Ctrl-Z', () => {
    render(<Harness onUndo={onUndo} onRedo={onRedo} />)
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(2)
    expect(onRedo).not.toHaveBeenCalled()
  })

  it('redoes on Cmd/Ctrl-Shift-Z', () => {
    render(<Harness onUndo={onUndo} onRedo={onRedo} />)
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(onRedo).toHaveBeenCalledTimes(2)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('redoes on Ctrl-Y', () => {
    render(<Harness onUndo={onUndo} onRedo={onRedo} />)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Y', metaKey: true })
    expect(onRedo).toHaveBeenCalledTimes(2)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('ignores Z without a modifier', () => {
    render(<Harness onUndo={onUndo} onRedo={onRedo} />)
    fireEvent.keyDown(window, { key: 'z' })
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('ignores keypresses while typing in a field', () => {
    const { getByLabelText } = render(
      <Harness onUndo={onUndo} onRedo={onRedo} />,
    )
    fireEvent.keyDown(getByLabelText('field'), { key: 'z', metaKey: true })
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    render(<Harness onUndo={onUndo} onRedo={onRedo} enabled={false} />)
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('suppresses the default only when an edit was reversed', () => {
    // Nothing to undo: the handler must let the browser keep its native Cmd-Z.
    render(<Harness onUndo={() => false} onRedo={() => false} />)
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      cancelable: true,
    })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)

    // Something to undo: the default is suppressed.
    render(<Harness onUndo={() => true} onRedo={() => true} />)
    const handled = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      cancelable: true,
    })
    window.dispatchEvent(handled)
    expect(handled.defaultPrevented).toBe(true)
  })
})
