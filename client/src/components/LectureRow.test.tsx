/**
 * Unit tests for the lecture row kebab menu: owner lists get Share
 * (deep-links to the sharing settings) and Delete (confirms first);
 * read-only lists (public profiles) get no menu at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import type { Deck } from '@slide-machine/shared'
import LectureRow from './LectureRow'
import { mockFetchRoutes } from '../test/fetch-mock'

const deck: Deck = {
  id: 'd1',
  projectId: 'p1',
  ownerId: 'u1',
  title: 'Waves',
  templateId: 'classic',
  visibility: 'public',
  accessInherited: true,
  permalinkSlug: 'waves-abc123',
  slideOrder: ['s1'],
  voteScore: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

function ViewerStub() {
  const location = useLocation()
  const state = location.state as { settingsTab?: string } | null
  return <div>VIEWER tab={state?.settingsTab ?? 'none'}</div>
}

const renderRow = (onDeleted?: (id: string) => void) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <ul>
              <LectureRow deck={deck} onDeleted={onDeleted} />
            </ul>
          }
        />
        <Route path="/d/:slug" element={<ViewerStub />} />
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LectureRow kebab menu', () => {
  it('is absent from read-only lists', () => {
    renderRow()
    expect(
      screen.queryByRole('button', { name: 'Options for Waves' }),
    ).not.toBeInTheDocument()
  })

  it('Settings opens the lecture on its General settings tab', () => {
    renderRow(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: 'Options for Waves' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(screen.getByText('VIEWER tab=general')).toBeInTheDocument()
  })

  it('Share opens the lecture on its Privacy & Sharing settings', () => {
    renderRow(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: 'Options for Waves' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }))
    expect(screen.getByText('VIEWER tab=sharing')).toBeInTheDocument()
  })

  it('Delete confirms, dispatches deck.delete, and reports back', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.delete': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: { deleted: true } }
      },
    })
    const onDeleted = vi.fn()
    renderRow(onDeleted)

    fireEvent.click(screen.getByRole('button', { name: 'Options for Waves' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    // Cancel first: nothing happens
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDeleted).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Options for Waves' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith('d1'))
    expect(sent).toEqual({ deckId: 'd1' })
  })

  it('closes on Escape without acting', () => {
    renderRow(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: 'Options for Waves' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
