/**
 * Unit tests for the auto-saving seed-notes editor: debounced save,
 * blur and unmount flushes, and no redundant saves.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SeedNotesEditor from './SeedNotesEditor'

describe('SeedNotesEditor', () => {
  it('saves after the debounce and flushes on blur', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    render(
      <SeedNotesEditor value="" label="Project seed notes" onSave={onSave} />,
    )
    const box = screen.getByRole('textbox', { name: 'Project seed notes' })

    fireEvent.change(box, { target: { value: 'Key topics' } })
    expect(onSave).not.toHaveBeenCalled()
    vi.advanceTimersByTime(800)
    expect(onSave).toHaveBeenCalledWith('Key topics')

    fireEvent.change(box, { target: { value: 'Key topics, expanded' } })
    fireEvent.blur(box)
    expect(onSave).toHaveBeenCalledWith('Key topics, expanded')
    vi.useRealTimers()
  })

  it('flushes a pending save when it goes away', () => {
    // The regression: typing a note and starting the lecture straight
    // away closed the seed dialog inside the debounce window, and the
    // pending timer was dropped rather than run — the note was lost
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { unmount } = render(
      <SeedNotesEditor value="" label="Lecture seed notes" onSave={onSave} />,
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Lecture seed notes' }),
      {
        target: { value: 'Cell biology basics' },
      },
    )

    unmount()
    expect(onSave).toHaveBeenCalledWith('Cell biology basics')
    // …and the dropped timer must not fire a second, duplicate save
    vi.advanceTimersByTime(1000)
    expect(onSave).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('saves nothing when it goes away untouched', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const { unmount } = render(
      <SeedNotesEditor
        value="Existing"
        label="Lecture seed notes"
        onSave={onSave}
      />,
    )
    unmount()
    expect(onSave).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not re-save unchanged text on blur', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    render(
      <SeedNotesEditor
        value="Existing"
        label="Lecture seed notes"
        onSave={onSave}
      />,
    )
    const box = screen.getByRole('textbox', { name: 'Lecture seed notes' })
    fireEvent.blur(box)
    vi.advanceTimersByTime(1000)
    expect(onSave).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
