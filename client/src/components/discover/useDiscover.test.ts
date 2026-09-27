/**
 * Unit tests for `useDiscover`'s own edge cases (TMPL-28 round 3), beyond
 * what `DeckFeed.test.tsx` and `DesignTemplatesPage.test.tsx` already cover
 * through a real list: an all-duplicate "load more" response, a delete
 * racing one still in flight, and patching a row's own data in place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDiscover, type DiscoverSource } from './useDiscover'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions', () => ({ dispatchAction: vi.fn() }))
const mockDispatch = vi.mocked(dispatchAction)

/** A minimal row — just enough for `useDiscover`'s own `{id: string}`
 * constraint, plus whatever one test needs to check on it. */
interface Row {
  id: string
  votes?: { up: number; down: number; myVote: 1 | -1 | 0 }
}

const SOURCE: DiscoverSource<Row> = {
  feedAction: 'row.feed',
  searchAction: 'row.search',
}

beforeEach(() => {
  mockDispatch.mockReset()
})

describe('useDiscover: an all-duplicate "load more" response', () => {
  it('drops the duplicates, keeps the page reference stable, and the next offset correct', async () => {
    mockDispatch.mockResolvedValueOnce({ items: [{ id: 'a' }], hasMore: true })
    const { result } = renderHook(() => useDiscover<Row>({ source: SOURCE }))
    await waitFor(() => expect(result.current.page).not.toBeNull())

    const pageBefore = result.current.page

    // The response answers with nothing new — every id it names is already
    // on screen.
    mockDispatch.mockResolvedValueOnce({ items: [{ id: 'a' }], hasMore: true })
    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(result.current.page?.lectures.map(r => r.id)).toEqual(['a'])
    // Nothing to append means nothing changed — the same page object
    // (`return prev`), not a same-content copy of it: a copy would still
    // read as a change to anything watching this value's identity, such as
    // `LoadMore`'s own IntersectionObserver, which rebuilds and immediately
    // re-fires on any new `loadMore` a changed `page` produces.
    expect(result.current.page).toBe(pageBefore)

    // A second "load more" must still ask for offset 1 (the one row this
    // hook actually holds), not 2 (as if the duplicate had been counted).
    mockDispatch.mockResolvedValueOnce({ items: [{ id: 'b' }], hasMore: false })
    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(mockDispatch).toHaveBeenLastCalledWith('row.feed', {
      sort: 'latest',
      offset: 1,
      limit: 10,
    })
    expect(result.current.page?.lectures.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('useDiscover: a delete racing an in-flight load more', () => {
  it('corrects the offset a stale response was fetched at', async () => {
    mockDispatch.mockResolvedValueOnce({
      items: [{ id: 'a' }, { id: 'b' }],
      hasMore: true,
    })
    const { result } = renderHook(() => useDiscover<Row>({ source: SOURCE }))
    await waitFor(() => expect(result.current.page).not.toBeNull())

    // The "load more" fetch starts (offset 2) but does not resolve yet.
    let resolveLoadMore: ((res: unknown) => void) | undefined
    mockDispatch.mockReturnValueOnce(
      new Promise(resolve => {
        resolveLoadMore = resolve
      }),
    )
    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    // While it is still in flight, one of the two rows already on screen is
    // deleted — the caller's own `template.delete` (or `deck`'s equivalent)
    // has already finished; only telling this hook about it is still
    // pending relative to the load-more fetch issued moments earlier.
    act(() => {
      result.current.remove('a')
    })
    expect(result.current.page?.lectures.map(r => r.id)).toEqual(['b'])

    // The stale response — fetched at offset 2, before the delete — answers
    // with what would have come after both original rows. One of its own
    // two rows is dropped to correct for the row removed underneath it.
    await act(async () => {
      resolveLoadMore?.({ items: [{ id: 'c' }, { id: 'd' }], hasMore: false })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(result.current.page?.lectures.map(r => r.id)).toEqual(['b', 'd'])
  })
})

describe('useDiscover: patching a row in place', () => {
  it('rewrites one row without waiting for a refetch', async () => {
    mockDispatch.mockResolvedValueOnce({
      items: [{ id: 'a', votes: { up: 0, down: 0, myVote: 0 } }],
      hasMore: false,
    })
    const { result } = renderHook(() => useDiscover<Row>({ source: SOURCE }))
    await waitFor(() => expect(result.current.page).not.toBeNull())

    act(() => {
      result.current.patch('a', row => ({
        ...row,
        votes: { up: 1, down: 0, myVote: 1 },
      }))
    })

    expect(result.current.page?.lectures[0]?.votes).toEqual({
      up: 1,
      down: 0,
      myVote: 1,
    })
  })
})
