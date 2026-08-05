/**
 * Unit tests for the admin lecture table shared by the user and project
 * pages: the rows it renders, its per-row actions, and the local sorting
 * its column headers apply.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import LectureTable from './LectureTable'
import type { AdminDeckSummary } from '../../api/admin'

/** Three lectures whose columns each imply a different order, so a sort
 * on the wrong column is visible in the sequence. */
const decks: AdminDeckSummary[] = [
  {
    id: 'd1',
    title: 'Metamorphic',
    visibility: 'public',
    slideCount: 12,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'd2',
    title: 'Amber',
    visibility: 'restricted',
    slideCount: 30,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-05T00:00:00Z',
  },
  {
    id: 'd3',
    title: 'Zebras',
    visibility: 'restricted',
    slideCount: 4,
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
] as AdminDeckSummary[]

const renderTable = (rows = decks) => {
  const onDelete = vi.fn()
  render(
    <MemoryRouter>
      <LectureTable decks={rows} onDelete={onDelete} />
    </MemoryRouter>,
  )
  return { onDelete }
}

/** The lecture titles as currently ordered on screen. */
const titles = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1) // the header row
    .map(row => row.querySelector('a')?.textContent?.trim() ?? '')

describe('LectureTable', () => {
  it('lists the lectures in the order given until a column is clicked', () => {
    renderTable()
    expect(titles()).toEqual(['Metamorphic', 'Amber', 'Zebras'])
    // Nothing claims to be sorting the table yet
    for (const cell of screen.getAllByRole('columnheader')) {
      expect(cell.getAttribute('aria-sort') ?? 'none').toBe('none')
    }
  })

  it('sorts by title, then flips on a second click', () => {
    renderTable()

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    expect(titles()).toEqual(['Amber', 'Metamorphic', 'Zebras'])
    expect(
      screen.getByRole('columnheader', { name: 'Lecture' }),
    ).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    expect(titles()).toEqual(['Zebras', 'Metamorphic', 'Amber'])
  })

  it('sorts slide counts as numbers rather than as text', () => {
    renderTable()

    fireEvent.click(screen.getByRole('button', { name: 'Slides' }))
    // 4 before 12 before 30 — as text, "12" would sort ahead of "4"
    expect(titles()).toEqual(['Zebras', 'Metamorphic', 'Amber'])
  })

  it('sorts by the last-edited date', () => {
    renderTable()

    fireEvent.click(screen.getByRole('button', { name: 'Updated' }))
    expect(titles()).toEqual(['Amber', 'Zebras', 'Metamorphic'])
  })

  it('sorts by visibility, and only one column sorts at a time', () => {
    renderTable()

    fireEvent.click(screen.getByRole('button', { name: 'Visibility' }))
    expect(titles()[0]).toBe('Metamorphic') // public before restricted
    expect(
      screen.getByRole('columnheader', { name: 'Visibility' }),
    ).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    expect(
      screen.getByRole('columnheader', { name: 'Visibility' }),
    ).toHaveAttribute('aria-sort', 'none')
    expect(
      screen.getByRole('columnheader', { name: 'Lecture' }),
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts an untitled lecture under the name it is shown by', () => {
    renderTable([
      { ...decks[0]!, id: 'd9', title: '   ' },
      { ...decks[1]! },
    ] as AdminDeckSummary[])

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    expect(titles()).toEqual(['Amber', 'Untitled lecture'])
  })

  it('still hands the right row to the delete action once sorted', () => {
    const { onDelete } = renderTable()

    fireEvent.click(screen.getByRole('button', { name: 'Lecture' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete lecture Amber' }),
    )
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd2', title: 'Amber' }),
    )
  })
})
