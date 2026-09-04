/**
 * Unit tests for full-screen keyboard toggling (PLAY-5): f/F and
 * Meta/Ctrl+Enter toggle, Escape exits only while active, none of the three
 * fire while a dialog (role="dialog" or "alertdialog") is open, and typing
 * fields are left alone.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { useFullScreenKeys } from './useFullScreenKeys'

function Harness({
  active,
  onToggle,
  onExit,
  dialogOpen = false,
}: {
  active: boolean
  onToggle: () => void
  onExit: () => void
  /** Stands in for an open Modal (role="dialog") or ConfirmDialog/
   * UnsavedChangesDialog (role="alertdialog") — whose real Escape handling
   * this test cannot exercise directly (that lives in Modal.tsx). */
  dialogOpen?: false | 'dialog' | 'alertdialog'
}) {
  useFullScreenKeys({ active, onToggle, onExit })
  return (
    <>
      <input aria-label="typing field" />
      {dialogOpen && <div role={dialogOpen} aria-label="a dialog" />}
    </>
  )
}

describe('useFullScreenKeys', () => {
  it('toggles on "f"', () => {
    const onToggle = vi.fn()
    render(<Harness active={false} onToggle={onToggle} onExit={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'f' })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('toggles on "F"', () => {
    const onToggle = vi.fn()
    render(<Harness active={false} onToggle={onToggle} onExit={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'F' })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('ignores "f" while typing in a field', () => {
    const onToggle = vi.fn()
    render(<Harness active={false} onToggle={onToggle} onExit={vi.fn()} />)
    fireEvent.keyDown(screen.getByLabelText('typing field'), { key: 'f' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('toggles on Meta+Enter', () => {
    const onToggle = vi.fn()
    render(<Harness active={false} onToggle={onToggle} onExit={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('toggles on Ctrl+Enter', () => {
    const onToggle = vi.fn()
    render(<Harness active={false} onToggle={onToggle} onExit={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('does not toggle on bare Enter', () => {
    const onToggle = vi.fn()
    render(<Harness active={false} onToggle={onToggle} onExit={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('exits on Escape only when active', () => {
    const onExit = vi.fn()
    const { rerender } = render(
      <Harness active={false} onToggle={vi.fn()} onExit={onExit} />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).not.toHaveBeenCalled()

    rerender(<Harness active={true} onToggle={vi.fn()} onExit={onExit} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('does not exit on Escape while an open dialog is present', () => {
    const onExit = vi.fn()
    render(
      <Harness
        active={true}
        onToggle={vi.fn()}
        onExit={onExit}
        dialogOpen="dialog"
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).not.toHaveBeenCalled()
  })

  it('does not exit on Escape while an open alertdialog (ConfirmDialog) is present', () => {
    const onExit = vi.fn()
    render(
      <Harness
        active={true}
        onToggle={vi.fn()}
        onExit={onExit}
        dialogOpen="alertdialog"
      />,
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).not.toHaveBeenCalled()
  })

  it('does not toggle on "f" while an open dialog is present', () => {
    const onToggle = vi.fn()
    render(
      <Harness
        active={false}
        onToggle={onToggle}
        onExit={vi.fn()}
        dialogOpen="dialog"
      />,
    )
    fireEvent.keyDown(window, { key: 'f' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('does not toggle on "f" while an open alertdialog is present', () => {
    const onToggle = vi.fn()
    render(
      <Harness
        active={false}
        onToggle={onToggle}
        onExit={vi.fn()}
        dialogOpen="alertdialog"
      />,
    )
    fireEvent.keyDown(window, { key: 'f' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('does not toggle on Meta+Enter while an open dialog is present', () => {
    const onToggle = vi.fn()
    render(
      <Harness
        active={false}
        onToggle={onToggle}
        onExit={vi.fn()}
        dialogOpen="dialog"
      />,
    )
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(onToggle).not.toHaveBeenCalled()
  })
})
