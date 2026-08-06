/**
 * Unit tests for the sortable column header shared by every admin table:
 * which column is marked, the direction arrow it shows, and what a click
 * asks for.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SortHeader from './SortHeader'

type Sort = `${'email' | 'joined'}:${'asc' | 'desc'}`

/** An ordinary column and a date column side by side, so an active and an
 * inactive column — and both arrow conventions — can be compared in one
 * render. */
const renderHeaders = (sort: Sort | null, onSort = vi.fn()) => {
  render(
    <table>
      <thead>
        <tr>
          <SortHeader label="Email" field="email" sort={sort} onSort={onSort} />
          <SortHeader
            label="Joined"
            field="joined"
            sort={sort}
            onSort={onSort}
            chronological
          />
        </tr>
      </thead>
    </table>,
  )
  return { onSort }
}

const header = (name: string): HTMLElement =>
  screen.getByRole('columnheader', { name })

describe('SortHeader', () => {
  it('marks only the sorting column, with an arrow for its direction', () => {
    renderHeaders('email:asc')

    expect(header('Email')).toHaveAttribute('aria-sort', 'ascending')
    // A–Z reads downwards, so ascending points down
    expect(within(header('Email')).getByText('↓')).toBeInTheDocument()

    // The other column carries its label alone — no arrow, and nothing
    // claiming it is sorted
    expect(header('Joined')).toHaveAttribute('aria-sort', 'none')
    expect(within(header('Joined')).queryByText(/[↑↓↕]/)).toBeNull()
  })

  it('points an ordinary column up when it sorts descending', () => {
    renderHeaders('email:desc')

    expect(header('Email')).toHaveAttribute('aria-sort', 'descending')
    expect(within(header('Email')).getByText('↑')).toBeInTheDocument()
  })

  it('points a date column up when it sorts oldest first', () => {
    renderHeaders('joined:asc')

    expect(header('Joined')).toHaveAttribute('aria-sort', 'ascending')
    expect(within(header('Joined')).getByText('↑')).toBeInTheDocument()
    expect(within(header('Email')).queryByText(/[↑↓↕]/)).toBeNull()
  })

  it('points a date column down when it sorts newest first', () => {
    renderHeaders('joined:desc')

    expect(header('Joined')).toHaveAttribute('aria-sort', 'descending')
    expect(within(header('Joined')).getByText('↓')).toBeInTheDocument()
  })

  it('marks no column when nothing is sorting the table', () => {
    renderHeaders(null)

    for (const name of ['Email', 'Joined']) {
      expect(header(name)).toHaveAttribute('aria-sort', 'none')
      expect(within(header(name)).queryByText(/[↑↓↕]/)).toBeNull()
    }
  })

  it('sorts a fresh column ascending and flips the sorting one', () => {
    const { onSort } = renderHeaders('email:asc')

    fireEvent.click(screen.getByRole('button', { name: 'Joined' }))
    expect(onSort).toHaveBeenCalledWith('joined:asc')

    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    expect(onSort).toHaveBeenCalledWith('email:desc')
  })

  it('flips a descending column back to ascending', () => {
    const { onSort } = renderHeaders('email:desc')

    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    expect(onSort).toHaveBeenCalledWith('email:asc')
  })
})
