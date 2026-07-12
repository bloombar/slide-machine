/**
 * Unit tests for the auto-saving seed-notes editor: debounced save,
 * blur flush, and no redundant saves.
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
