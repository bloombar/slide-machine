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
})
