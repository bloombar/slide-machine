/**
 * Unit tests for the Design Templates page (TMPL-28): every design the
 * caller can browse, with Latest/Top/Mine sorting, search, infinite scroll,
 * and the same duplicate/edit/delete/vote actions the Design tab offers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Template } from '@slide-machine/shared'
import DesignTemplatesPage from './DesignTemplatesPage'
import { dispatchAction } from '../api/actions'

vi.mock('../api/actions', () => ({ dispatchAction: vi.fn() }))
const mockDispatch = vi.mocked(dispatchAction)

const template = (over: Partial<Template> = {}): Template => ({
  id: 'built-1',
  permalinkSlug: 'built-1',
  ownerId: 'system',
  name: 'Shipped',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [
    {
      type: 'content',
      label: 'Content',
      purpose: 'use for content',
      slots: [{ name: 'title', kind: 'text', label: 'title' }],
      elementPositions: { title: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 } },
    },
  ] as Template['layouts'],
  visibility: 'public',
  myRole: null,
  owner: null,
  voteScore: 0,
  votes: { up: 0, down: 0, myVote: 0 },
  layoutCount: 1,
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const mine = template({
  id: 'mine-1',
  permalinkSlug: 'my-style-ab12',
  ownerId: 'u1',
  name: 'My Style',
  visibility: 'restricted',
  myRole: 'owner',
  owner: { id: 'u1', displayName: 'Ada' },
  layoutCount: 3,
  description: 'A tidy design for lecture slides.',
})

/** Stands in for a design's own page, so a test can say where it landed and
 * what it was told about where to return to. */
function Landed() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p>{`landed:${location.pathname} from:${from ?? ''}`}</p>
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/app/templates']}>
      <Routes>
        <Route path="/app/templates" element={<DesignTemplatesPage />} />
        <Route path="/t/:slug" element={<Landed />} />
        <Route path="/u/:userId" element={<p>profile</p>} />
      </Routes>
    </MemoryRouter>,
  )

const searchBox = () => screen.getByRole('searchbox')

beforeEach(() => {
  mockDispatch.mockReset()
})
afterEach(cleanup)

describe('DesignTemplatesPage sorting and search (TMPL-28)', () => {
  it('fetches template.feed with the latest sort by default', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    await screen.findByText('Shipped')
    expect(mockDispatch).toHaveBeenCalledWith('template.feed', {
      sort: 'latest',
      offset: 0,
      limit: 10,
    })
  })

  it('refetches with the top sort when Top is clicked', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith('template.feed', {
        sort: 'top',
        offset: 0,
        limit: 10,
      }),
    )
  })

  it('refetches with the mine sort when Mine is clicked', async () => {
    mockDispatch.mockImplementation(async (_name, input) => {
      const { sort } = input as { sort: string }
      return sort === 'mine'
        ? { items: [mine], hasMore: false }
        : { items: [template()], hasMore: false }
    })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith('template.feed', {
        sort: 'mine',
        offset: 0,
        limit: 10,
      }),
    )
  })

  it('searches template.search with the query, debounced', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.change(searchBox(), { target: { value: 'seminar' } })
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.search', {
        q: 'seminar',
        sort: 'latest',
        offset: 0,
        limit: 10,
      }),
    )
  })

  it('shows "no designs yet" when Mine is empty', async () => {
    mockDispatch.mockImplementation(async (_name, input) => {
      const { sort } = input as { sort: string }
      return sort === 'mine'
        ? { items: [], hasMore: false }
        : { items: [template()], hasMore: false }
    })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
    expect(await screen.findByText(/no designs yet/i)).toBeInTheDocument()
  })

  it('reports when a search matches nothing', async () => {
    mockDispatch.mockImplementation(async (name: string) =>
      name === 'template.feed'
        ? { items: [template()], hasMore: false }
        : { items: [], hasMore: false },
    )
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.change(searchBox(), { target: { value: 'zzz' } })
    expect(await screen.findByText(/no matches for/i)).toBeInTheDocument()
  })
})

describe('DesignTemplatesPage lazy loading (TMPL-28)', () => {
  it('appends the next page on load more', async () => {
    mockDispatch
      .mockResolvedValueOnce({ items: [template()], hasMore: true })
      .mockResolvedValueOnce({
        items: [template({ id: 'built-2', name: 'Second' })],
        hasMore: false,
      })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(await screen.findByText('Second')).toBeInTheDocument()
    expect(screen.getByText('Shipped')).toBeInTheDocument()
    expect(mockDispatch).toHaveBeenLastCalledWith('template.feed', {
      sort: 'latest',
      offset: 1,
      limit: 10,
    })
  })
})

describe('DesignTemplatesPage cards (TMPL-28)', () => {
  it('shows the creator link, layout count and description for a stored design', async () => {
    mockDispatch.mockResolvedValue({ items: [mine], hasMore: false })
    renderPage()
    await screen.findByText('My Style')
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/u/u1',
    )
    expect(screen.getByText('3 layouts')).toBeInTheDocument()
    expect(
      screen.getByText('A tidy design for lecture slides.'),
    ).toBeInTheDocument()
  })

  it('shows no creator link for a built-in', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    await screen.findByText('Shipped')
    expect(screen.queryByRole('link', { name: 'Ada' })).toBeNull()
    expect(screen.getByText('1 layout')).toBeInTheDocument()
  })

  it('hides edit and delete for a design the caller does not own', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    await screen.findByText('Shipped')
    expect(screen.queryByLabelText('Edit Shipped')).toBeNull()
    expect(screen.queryByLabelText('Delete Shipped')).toBeNull()
    expect(screen.getByLabelText('Duplicate Shipped')).toBeInTheDocument()
  })

  it('offers edit and delete on the caller’s own design', async () => {
    mockDispatch.mockResolvedValue({ items: [mine], hasMore: false })
    renderPage()
    await screen.findByText('My Style')
    expect(screen.getByLabelText('Edit My Style')).toBeInTheDocument()
    expect(screen.getByLabelText('Delete My Style')).toBeInTheDocument()
  })

  it('opens a design’s own page on click, remembering this page', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByRole('radio', { name: /Shipped/ }))
    expect(
      await screen.findByText('landed:/t/built-1 from:/app/templates'),
    ).toBeInTheDocument()
  })

  it('duplicates a design and opens the copy’s own page', async () => {
    mockDispatch.mockImplementation(async (name: string) => {
      if (name === 'template.duplicate')
        return template({
          id: 'copy-1',
          permalinkSlug: 'shipped-copy',
          name: 'Shipped copy',
          myRole: 'owner',
        })
      return { items: [template()], hasMore: false }
    })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByLabelText('Duplicate Shipped'))
    expect(
      await screen.findByText('landed:/t/shipped-copy from:/app/templates'),
    ).toBeInTheDocument()
  })

  it('confirms, dispatches and removes a design the owner deletes', async () => {
    mockDispatch.mockImplementation(async (name: string) => {
      if (name === 'template.delete') return {}
      return { items: [mine], hasMore: false }
    })
    renderPage()
    await screen.findByText('My Style')
    fireEvent.click(screen.getByLabelText('Delete My Style'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.delete', {
        templateId: 'mine-1',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByText('My Style')).not.toBeInTheDocument(),
    )
  })
})
