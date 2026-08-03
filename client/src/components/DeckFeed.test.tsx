/**
 * Unit tests for the Discover sidebar (SOC-2/SOC-3). Covers the Latest/Top
 * sort, the global search, the fact that the chosen sort is carried into search
 * as well as the feed, lazy paging via "Load more", and the read-only net
 * rating on each row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { FeedDeck } from '@slide-machine/shared'
import DeckFeed from './DeckFeed'
import DiscoverResults from './discover/DiscoverResults'
import { useDiscover } from './discover/useDiscover'
import { dispatchAction } from '../api/actions'

vi.mock('../api/actions', () => ({ dispatchAction: vi.fn() }))
const mockDispatch = vi.mocked(dispatchAction)

const row = (over: Partial<FeedDeck> = {}): FeedDeck => ({
  id: 'd1',
  slug: 'waves-abc',
  title: 'Waves',
  up: 4,
  down: 2,
  voteScore: 2,
  myVote: 0,
  updatedAt: '2026-07-01T00:00:00.000Z',
  owner: { id: 'u1', displayName: 'Ada' },
  project: { id: 'p1', title: 'Physics' },
  ...over,
})

/** The feed answers with one page and nothing after it. */
const onePage = (items: FeedDeck[] = [row()]) =>
  mockDispatch.mockResolvedValue({
    items,
    hasMore: false,
    lectures: items,
    projects: [],
    users: [],
  })

beforeEach(() => {
  mockDispatch.mockReset()
})

const renderFeed = () =>
  render(
    <MemoryRouter>
      <DeckFeed />
    </MemoryRouter>,
  )

const searchBox = () => screen.getByRole('searchbox', { name: /search/i })

describe('DeckFeed', () => {
  it('loads the latest feed: lecture, project, and owner all link', async () => {
    onePage()
    renderFeed()
    await screen.findByText('Waves')
    expect(mockDispatch).toHaveBeenCalledWith('deck.feed', {
      sort: 'latest',
      offset: 0,
      limit: 10,
    })
    expect(screen.getByRole('link', { name: 'Waves' })).toHaveAttribute(
      'href',
      '/d/waves-abc',
    )
    expect(screen.getByRole('link', { name: 'Physics' })).toHaveAttribute(
      'href',
      '/app/projects/p1',
    )
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/u/u1',
    )
  })

  it('shows one net rating per row, not two separate counts', async () => {
    onePage()
    renderFeed()
    await screen.findByText('Waves')
    // 4 up and 2 down read as a single "2"
    expect(screen.getByLabelText('Rating 2')).toHaveTextContent('2')
    // No voting from the list — that happens inside the lecture
    expect(screen.queryByRole('button', { name: 'Upvote' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Downvote' })).toBeNull()
  })

  it('refetches with the top sort when the Top tab is clicked', async () => {
    onePage()
    renderFeed()
    await screen.findByText('Waves')
    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith('deck.feed', {
        sort: 'top',
        offset: 0,
        limit: 10,
      }),
    )
  })

  it('shows an empty state when there are no public lectures', async () => {
    onePage([])
    renderFeed()
    expect(await screen.findByText(/no public lectures/i)).toBeInTheDocument()
  })

  it('reports a failure to load the feed', async () => {
    mockDispatch.mockRejectedValue(new Error('offline'))
    renderFeed()
    expect(
      await screen.findByText(/could not load the feed/i),
    ).toBeInTheDocument()
  })

  it('names the search, not the feed, when a search fails', async () => {
    mockDispatch.mockRejectedValue(new Error('offline'))
    renderFeed()
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    expect(
      await screen.findByText(/could not run that search/i),
    ).toBeInTheDocument()
  })
})

describe('DeckFeed lazy loading', () => {
  it('offers "Load more" only while further pages exist', async () => {
    mockDispatch.mockResolvedValueOnce({ items: [row()], hasMore: false })
    renderFeed()
    await screen.findByText('Waves')
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('appends the next page and asks for the right offset', async () => {
    mockDispatch
      .mockResolvedValueOnce({ items: [row()], hasMore: true })
      .mockResolvedValueOnce({
        items: [row({ id: 'd2', title: 'Optics', slug: 'optics-xyz' })],
        hasMore: false,
      })
    renderFeed()
    await screen.findByText('Waves')

    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(await screen.findByText('Optics')).toBeInTheDocument()
    // The first page is still there — pages append, they do not replace
    expect(screen.getByText('Waves')).toBeInTheDocument()
    expect(mockDispatch).toHaveBeenLastCalledWith('deck.feed', {
      sort: 'latest',
      offset: 1,
      limit: 10,
    })
    // Exhausted: the trigger goes away
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /load more/i })).toBeNull(),
    )
  })

  it('starts over at page one when the sort changes', async () => {
    mockDispatch.mockResolvedValue({ items: [row()], hasMore: true })
    renderFeed()
    await screen.findByText('Waves')
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith(
        'deck.feed',
        expect.objectContaining({ offset: 1 }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith('deck.feed', {
        sort: 'top',
        offset: 0,
        limit: 10,
      }),
    )
  })
})

describe('DeckFeed search (SOC-2)', () => {
  const results = {
    lectures: [
      row({
        id: 'd9',
        slug: 'cats-101',
        title: 'Cats 101',
        voteScore: 7,
        owner: { id: 'u2', displayName: 'Bo' },
        project: { id: 'p2', title: 'Biology' },
      }),
    ],
    hasMore: false,
    projects: [
      { id: 'p3', title: 'Cat facts', owner: { id: 'u2', displayName: 'Bo' } },
    ],
    users: [{ id: 'u3', displayName: 'Catlover' }],
  }

  const searchRoutes = () =>
    mockDispatch.mockImplementation(async (name: string) =>
      name === 'deck.feed' ? { items: [row()], hasMore: false } : results,
    )

  it('searches lectures, projects, and people, grouped and linked', async () => {
    searchRoutes()
    renderFeed()
    await screen.findByText('Waves') // the feed loaded first

    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    expect(await screen.findByText('Cats 101')).toBeInTheDocument()
    expect(mockDispatch).toHaveBeenCalledWith('social.search', {
      q: 'cat',
      sort: 'latest',
      offset: 0,
      limit: 10,
    })
    expect(screen.getByText('Lectures')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cats 101/ })).toHaveAttribute(
      'href',
      '/d/cats-101',
    )
    expect(screen.getByRole('link', { name: /Cat facts/ })).toHaveAttribute(
      'href',
      '/app/projects/p3',
    )
    expect(screen.getByRole('link', { name: 'Catlover' })).toHaveAttribute(
      'href',
      '/u/u3',
    )
  })

  it('shows the rating on search hits too', async () => {
    searchRoutes()
    renderFeed()
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    await screen.findByText('Cats 101')
    expect(screen.getByLabelText('Rating 7')).toBeInTheDocument()
  })

  it('carries the chosen sort into the search (SOC-2)', async () => {
    searchRoutes()
    renderFeed()
    await screen.findByText('Waves')
    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    await screen.findByText('Cats 101')
    expect(mockDispatch).toHaveBeenLastCalledWith('social.search', {
      q: 'cat',
      sort: 'top',
      offset: 0,
      limit: 10,
    })
  })

  it('re-runs the search when the sort changes mid-query', async () => {
    searchRoutes()
    renderFeed()
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    await screen.findByText('Cats 101')
    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith('social.search', {
        q: 'cat',
        sort: 'top',
        offset: 0,
        limit: 10,
      }),
    )
  })

  it('pages search results lazily', async () => {
    mockDispatch.mockImplementation(async (name: string, input?: object) => {
      if (name === 'deck.feed') return { items: [row()], hasMore: false }
      const { offset } = input as { offset: number }
      return offset === 0
        ? { ...results, hasMore: true }
        : {
            lectures: [row({ id: 'd10', title: 'Cats 202', slug: 'cats-202' })],
            hasMore: false,
            projects: [],
            users: [],
          }
    })
    renderFeed()
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    await screen.findByText('Cats 101')
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(await screen.findByText('Cats 202')).toBeInTheDocument()
    expect(screen.getByText('Cats 101')).toBeInTheDocument()
  })

  it('reports when a search matches nothing', async () => {
    mockDispatch.mockImplementation(async (name: string) =>
      name === 'deck.feed'
        ? { items: [row()], hasMore: false }
        : { lectures: [], hasMore: false, projects: [], users: [] },
    )
    renderFeed()
    fireEvent.change(searchBox(), { target: { value: 'zzz' } })
    expect(await screen.findByText(/no matches for/i)).toBeInTheDocument()
  })

  it('returns to the feed when the search box is cleared', async () => {
    searchRoutes()
    renderFeed()
    fireEvent.change(searchBox(), { target: { value: 'cat' } })
    await screen.findByText('Cats 101')
    fireEvent.change(searchBox(), { target: { value: '' } })
    expect(await screen.findByText('Waves')).toBeInTheDocument()
    expect(screen.queryByText('Cats 101')).toBeNull()
  })
})

/**
 * The discover module takes its actions and its row rendering from the caller,
 * so a second kind of browsable content can reuse it rather than fork it.
 */
describe('discover module seams', () => {
  it('pages whichever actions the source names', async () => {
    mockDispatch.mockResolvedValue({ items: [], hasMore: false })
    const Custom = () => {
      const discover = useDiscover({
        source: {
          feedAction: 'template.feed',
          searchAction: 'template.search',
        },
      })
      return <DiscoverResults discover={discover} />
    }
    render(
      <MemoryRouter>
        <Custom />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.feed', {
        sort: 'latest',
        offset: 0,
        limit: 10,
      }),
    )
    expect(mockDispatch).not.toHaveBeenCalledWith(
      'deck.feed',
      expect.anything(),
    )
  })

  it('draws rows the way the caller asks', async () => {
    mockDispatch.mockResolvedValue({ items: [row()], hasMore: false })
    const Custom = () => {
      const discover = useDiscover()
      return (
        <DiscoverResults
          discover={discover}
          renderRow={d => <li key={d.id}>custom:{d.title}</li>}
        />
      )
    }
    render(
      <MemoryRouter>
        <Custom />
      </MemoryRouter>,
    )
    expect(await screen.findByText('custom:Waves')).toBeInTheDocument()
    // The default lecture row is not used, so no link to the viewer
    expect(screen.queryByRole('link', { name: 'Waves' })).toBeNull()
  })
})
