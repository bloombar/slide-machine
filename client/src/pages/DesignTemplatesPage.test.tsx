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

/** The same page, opened as `TemplateEditorPage`'s Back would (TMPL-28): with
 * whatever `location.state` it carried, e.g. `{ sort: 'mine' }`. */
const renderPageWithState = (state: Record<string, unknown>) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app/templates', state }]}>
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

  // TMPL-28: `TemplateEditorPage`'s Back sets `location.state.sort` so the
  // design just left is where the caller lands, rather than this page's own
  // default.
  it('opens on "Mine" when navigation carries sort: "mine"', async () => {
    mockDispatch.mockImplementation(async (_name, input) => {
      const { sort } = input as { sort: string }
      return sort === 'mine'
        ? { items: [mine], hasMore: false }
        : { items: [template()], hasMore: false }
    })
    renderPageWithState({ sort: 'mine' })
    await screen.findByText('My Style')
    expect(mockDispatch).toHaveBeenCalledWith('template.feed', {
      sort: 'mine',
      offset: 0,
      limit: 10,
    })
    expect(screen.getByRole('button', { name: 'Mine' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('opens on "Latest" when navigation carries no sort at all', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPageWithState({ from: '/app' })
    await screen.findByText('Shipped')
    expect(mockDispatch).toHaveBeenCalledWith('template.feed', {
      sort: 'latest',
      offset: 0,
      limit: 10,
    })
  })

  // Only the literal 'mine' opens on "Mine" — anything else navigation might
  // carry, recognized or not, falls back to this page's own default rather
  // than being passed straight through to `template.feed`.
  it('opens on "Latest" when navigation carries a sort other than "mine"', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPageWithState({ sort: 'top' })
    await screen.findByText('Shipped')
    expect(mockDispatch).toHaveBeenCalledWith('template.feed', {
      sort: 'latest',
      offset: 0,
      limit: 10,
    })
  })

  it('opens on "Latest" when navigation carries a sort of the wrong type', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPageWithState({ sort: 42 })
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

  it('reports a failure to load the feed', async () => {
    mockDispatch.mockRejectedValue(new Error('offline'))
    renderPage()
    expect(
      await screen.findByText(/could not load the templates/i),
    ).toBeInTheDocument()
  })

  it('names the search, not the feed, when a search fails', async () => {
    mockDispatch.mockImplementation(async (name: string) =>
      name === 'template.feed'
        ? { items: [template()], hasMore: false }
        : Promise.reject(new Error('offline')),
    )
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    expect(
      await screen.findByText(/could not run that search/i),
    ).toBeInTheDocument()
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

  // Round 2: a delete must shrink the same count `loadMore`'s offset is
  // computed from, or the next page silently skips whatever the deleted
  // row's removal shifted into view on the server's own ordered list.
  it('fetches the offset that accounts for a delete, and shows the next item', async () => {
    const a = template({ id: 'a1', name: 'Alpha', myRole: 'owner' })
    const b = template({ id: 'a2', name: 'Beta', myRole: 'owner' })
    const c = template({ id: 'a3', name: 'Gamma', myRole: 'owner' })
    mockDispatch.mockImplementation(async (name: string, input) => {
      if (name === 'template.delete') return {}
      const { offset } = input as { offset: number }
      if (offset === 0) return { items: [a, b], hasMore: true }
      // The correct next offset is 1 (one row retained after the delete),
      // not 2 (the count fetched before it) — only the former lands on c.
      if (offset === 1) return { items: [c], hasMore: false }
      throw new Error(`unexpected offset ${offset}`)
    })
    renderPage()
    await screen.findByText('Alpha')
    await screen.findByText('Beta')

    fireEvent.click(screen.getByLabelText('Delete Alpha'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(await screen.findByText('Gamma')).toBeInTheDocument()
    expect(mockDispatch).toHaveBeenLastCalledWith('template.feed', {
      sort: 'latest',
      offset: 1,
      limit: 10,
    })
  })

  // Round 2: deleting every row on the loaded page must not read as "no
  // designs" while the server still has more to give.
  it('keeps "Load more" once every loaded row is deleted, while more remain', async () => {
    const a = template({ id: 'a1', name: 'Alpha', myRole: 'owner' })
    mockDispatch.mockImplementation(async (name: string) => {
      if (name === 'template.delete') return {}
      return { items: [a], hasMore: true }
    })
    renderPage()
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByLabelText('Delete Alpha'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())

    expect(screen.queryByText(/no designs/i)).toBeNull()
    expect(
      screen.getByRole('button', { name: /load more/i }),
    ).toBeInTheDocument()
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

  // Round 2: `owner` truthy but empty is not the same as no owner at all —
  // both must render no link, neither should render an empty, focusable one.
  it('shows no creator link when the owner has no display name', async () => {
    mockDispatch.mockResolvedValue({
      items: [template({ owner: { id: 'ghost', displayName: '' } })],
      hasMore: false,
    })
    renderPage()
    await screen.findByText('Shipped')
    // Only the card's own "opens the design" link should exist — no second,
    // empty one for a nameless owner.
    expect(screen.getAllByRole('link')).toHaveLength(1)
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
    fireEvent.click(screen.getByRole('link', { name: /Shipped/ }))
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

  it('shows a localised error and stays put when duplicate fails', async () => {
    mockDispatch.mockImplementation(async (name: string) => {
      if (name === 'template.duplicate')
        return Promise.reject(new Error('nope'))
      return { items: [template()], hasMore: false }
    })
    renderPage()
    await screen.findByText('Shipped')
    fireEvent.click(screen.getByLabelText('Duplicate Shipped'))
    expect(
      await screen.findByText('Could not duplicate that template'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^landed:/)).toBeNull()
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

  it('cancelling the confirm dialog dispatches nothing and keeps the row', async () => {
    mockDispatch.mockResolvedValue({ items: [mine], hasMore: false })
    renderPage()
    await screen.findByText('My Style')
    fireEvent.click(screen.getByLabelText('Delete My Style'))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mockDispatch).not.toHaveBeenCalledWith(
      'template.delete',
      expect.anything(),
    )
    expect(screen.getByText('My Style')).toBeInTheDocument()
  })

  it('closes the dialog, shows a localised error, and keeps the row when delete fails', async () => {
    mockDispatch.mockImplementation(async (name: string) => {
      if (name === 'template.delete') return Promise.reject(new Error('nope'))
      return { items: [mine], hasMore: false }
    })
    renderPage()
    await screen.findByText('My Style')
    fireEvent.click(screen.getByLabelText('Delete My Style'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText('Could not delete the template'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('My Style')).toBeInTheDocument()
  })

  it('disables confirm and cancel while the delete is in flight', async () => {
    let resolveDelete: (() => void) | undefined
    mockDispatch.mockImplementation(async (name: string) => {
      if (name === 'template.delete')
        return new Promise(resolve => {
          resolveDelete = () => resolve({})
        })
      return { items: [mine], hasMore: false }
    })
    renderPage()
    await screen.findByText('My Style')
    fireEvent.click(screen.getByLabelText('Delete My Style'))
    const confirm = await screen.findByRole('button', { name: 'Delete' })
    fireEvent.click(confirm)
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    resolveDelete?.()
    await waitFor(() => expect(screen.queryByText('My Style')).toBeNull())
  })
})

describe('DesignTemplatesPage votes (TMPL-28 round 3)', () => {
  // A sort switch away and back can land on the exact page `useDiscover`
  // already holds, shown again before its own fresh refetch has returned —
  // proving this needs seeing that reused, *cached* render still carries a
  // vote cast before the round trip, not the zero the original fetch
  // answered with.
  it('keeps a cast vote in a page reused across a quick sort round trip', async () => {
    mockDispatch.mockImplementation(async (name: string, input) => {
      if (name === 'template.vote')
        return { up: 1, down: 0, myVote: 1, voteScore: 1 }
      const { sort } = input as { sort: string }
      if (sort === 'top') {
        // Never resolves within this test: the point is to be still in
        // flight when the sort flips straight back to latest.
        return new Promise(() => {})
      }
      return { items: [template()], hasMore: false }
    })
    renderPage()
    await screen.findByText('Shipped')

    const upvote = () => screen.getByRole('button', { name: 'Upvote Shipped' })
    fireEvent.click(upvote())
    await waitFor(() => expect(upvote()).toHaveTextContent('1'))

    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }))

    expect(upvote()).toHaveTextContent('1')
  })
})

describe('DesignTemplatesPage heading and explanation (TMPL-28)', () => {
  it('explains what a design template is for, under a sentence-case heading', async () => {
    mockDispatch.mockResolvedValue({ items: [template()], hasMore: false })
    renderPage()
    expect(
      screen.getByRole('heading', { name: 'Design templates' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/each new slide automatically picks/i),
    ).toBeInTheDocument()
  })
})
