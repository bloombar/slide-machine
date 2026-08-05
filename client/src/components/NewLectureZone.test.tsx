/**
 * Unit tests for NewLectureZone: the row offers one thing, "New lecture".
 * Importing (EXP-3) is a project-level action and lives with the project's
 * controls — the kebab on the home screen, the header on a project page — so
 * it is deliberately absent here.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NewLectureZone from './NewLectureZone'

describe('NewLectureZone', () => {
  it('starts a new lecture when the New lecture button is clicked', () => {
    const onStart = vi.fn()
    render(<NewLectureZone projectTitle="Physics" onStart={onStart} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a new lecture in Physics' }),
    )
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('fills the dashed row with the button, so all of it is clickable', () => {
    render(<NewLectureZone onStart={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Start a new lecture' })
    // jsdom has no layout, so the mechanism is what can be asserted: the
    // button carries the row's padding and spans its width.
    expect(button).toHaveClass('w-full', 'px-4', 'py-2')
    expect(button.parentElement?.className).not.toMatch(/\bp[xy]?-/)
  })
})
