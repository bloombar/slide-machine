/**
 * Unit tests for `useCurrentTemplate` (TMPL-28): fetches a design by id once,
 * and does not refetch once the caller has already set the matching object
 * itself (the optimistic case right after `onSelect`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
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

afterEach(cleanup)

describe('useCurrentTemplate (TMPL-28)', () => {
  it('fetches the design by id', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(template({ id: 'a' }))
    const { result } = renderHook(() => useCurrentTemplate('a'))

    await waitFor(() => expect(result.current[0]?.id).toBe('a'))
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
    await waitFor(() => expect(result.current[0]?.id).toBe('a'))
    vi.mocked(dispatchAction).mockClear()

    // The caller sets the object itself, the way `onSelect`'s optimistic
    // update does, then the id changes to match it — no extra fetch.
    result.current[1](template({ id: 'b', name: 'Optimistic' }))
    rerender({ id: 'b' })

    expect(dispatchAction).not.toHaveBeenCalled()
  })

  it('does not fetch when there is no id at all', () => {
    renderHook(() => useCurrentTemplate(''))
    expect(dispatchAction).not.toHaveBeenCalled()
  })
})
