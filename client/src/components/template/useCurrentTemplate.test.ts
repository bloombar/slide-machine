/**
 * Unit tests for `useCurrentTemplate` (TMPL-28): fetches a design by id once,
 * and does not refetch once the caller has already set the matching object
 * itself (the optimistic case right after `onSelect`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import type { Template } from '@slide-machine/shared'
import { useCurrentTemplate } from './useCurrentTemplate'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions')

const template = (over: Partial<Template> = {}): Template => ({
  id: 'built-1',
  permalinkSlug: 'built-1',
  ownerId: 'system',
  name: 'Shipped',
  theme: {},
  layouts: [],
  visibility: 'public',
  myRole: null,
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

beforeEach(() => vi.mocked(dispatchAction).mockReset())
afterEach(cleanup)

describe('useCurrentTemplate (TMPL-28)', () => {
  it('fetches the design by id', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(template({ id: 'a' }))
    const { result } = renderHook(() => useCurrentTemplate('a'))

    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    expect(dispatchAction).toHaveBeenCalledWith('template.getById', {
      templateId: 'a',
    })
  })

  it('does not refetch once the caller already holds a matching object', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(template({ id: 'a' }))
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCurrentTemplate(id),
      { initialProps: { id: 'a' } },
    )
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    vi.mocked(dispatchAction).mockClear()

    // The caller sets the object itself, the way `onSelect`'s optimistic
    // update does, then the id changes to match it — no extra fetch. Both in
    // one `act`, batched together the way a real caller's `.then()` handler
    // (which sets its own state and calls back into a parent whose prop feeds
    // `templateId` here) batches under React 18 regardless of where it runs.
    act(() => {
      result.current.setCurrent(template({ id: 'b', name: 'Optimistic' }))
      rerender({ id: 'b' })
    })

    expect(dispatchAction).not.toHaveBeenCalled()
  })

  it('does not fetch when there is no id at all, and reports nothing applied', () => {
    const { result } = renderHook(() => useCurrentTemplate(''))
    expect(dispatchAction).not.toHaveBeenCalled()
    // null, not undefined: undefined means "still loading" to the panel,
    // which would then wait forever
    expect(result.current.current).toBeNull()
  })

  it('patches the vote on the current design without touching anything else', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(
      template({ id: 'a', votes: { up: 0, down: 0, myVote: 0 } }),
    )
    const { result } = renderHook(() => useCurrentTemplate('a'))
    await waitFor(() => expect(result.current.current?.id).toBe('a'))

    act(() =>
      result.current.patchVote('a', {
        up: 1,
        down: 0,
        voteScore: 1,
        myVote: 1,
      }),
    )

    expect(result.current.current?.votes).toEqual({
      up: 1,
      down: 0,
      myVote: 1,
    })
    expect(result.current.current?.id).toBe('a')
  })

  it('ignores a vote for a design that is not the current one', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(template({ id: 'a' }))
    const { result } = renderHook(() => useCurrentTemplate('a'))
    await waitFor(() => expect(result.current.current?.id).toBe('a'))

    act(() =>
      result.current.patchVote('other', {
        up: 1,
        down: 0,
        voteScore: 1,
        myVote: 1,
      }),
    )

    expect(result.current.current?.votes).toBeUndefined()
  })
})
