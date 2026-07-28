/**
 * Unit tests for NewLectureZone: it always offers "New lecture", and offers
 * "Import" only when an onImport handler is supplied, forwarding the chosen file
 * (EXP-3).
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

  it('hides the Import affordance when no onImport handler is given', () => {
    render(<NewLectureZone projectTitle="Physics" onStart={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: /Import a lecture/ }),
    ).not.toBeInTheDocument()
  })

  it('forwards the chosen file to onImport', () => {
    const onImport = vi.fn()
    render(
      <NewLectureZone
        projectTitle="Physics"
        onStart={vi.fn()}
        onImport={onImport}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Import a lecture into Physics' }),
    ).toBeInTheDocument()
    const file = new File(['version: 1'], 'deck.yaml', {
      type: 'application/x-yaml',
    })
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(onImport).toHaveBeenCalledWith(file)
  })
})
