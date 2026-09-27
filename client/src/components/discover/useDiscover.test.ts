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
  it('drops the duplicates and stops loading rather than re-asking the same offset', async () => {
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
    expect(pageBefore?.hasMore).toBe(true)
    // Re-asking would return the same duplicates forever, and `LoadMore`
    // re-fires whenever `loadMore` changes identity — so the list stops.
    expect(result.current.page?.hasMore).toBe(false)
    const calls = mockDispatch.mock.calls.length
    await act(async () => {
      result.current.loadMore()
    })
    expect(mockDispatch.mock.calls.length).toBe(calls)
  })
})

describe('useDiscover: a delete racing an in-flight load more', () => {
  it('discards the answer that crossed the delete and asks again from the corrected offset', async () => {
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

    // Whether the server read that page before or after the delete is
    // unknowable, so its answer is set aside — neither 'c' nor 'd' lands,
    // and the list still has more to load.
    await act(async () => {
      resolveLoadMore?.({ items: [{ id: 'c' }, { id: 'd' }], hasMore: false })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))
    expect(result.current.page?.lectures.map(r => r.id)).toEqual(['b'])
    expect(result.current.page?.hasMore).toBe(true)

    // The next load asks from the corrected offset, 1, and lands whatever
    // follows 'b' under the server's post-delete order.
    mockDispatch.mockResolvedValueOnce({
      items: [{ id: 'c' }, { id: 'd' }],
      hasMore: false,
    })
    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))
    expect(mockDispatch).toHaveBeenLastCalledWith('row.feed', {
      sort: 'latest',
      offset: 1,
      limit: 10,
    })
    expect(result.current.page?.lectures.map(r => r.id)).toEqual([
      'b',
      'c',
      'd',
    ])
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
