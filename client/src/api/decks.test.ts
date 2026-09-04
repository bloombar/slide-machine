/**
 * Unit tests for the view beacon (EVAL-7).
 *
 * Two things matter about it and neither is the happy path: it must reach the
 * right endpoint as a POST, and it must never let a failed statistic surface
 * as a rejected promise in the page that called it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { recordDeckView } from './decks'
import { mockFetchRoutes } from '../test/fetch-mock'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recordDeckView', () => {
  it('posts to the lecture it names', async () => {
    const methods: (string | undefined)[] = []
    const { calls } = mockFetchRoutes({
      '/api/decks/waves-abc/view': init => {
        methods.push(init?.method)
        return { status: 204, body: null }
      },
    })

    await recordDeckView('waves-abc')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/api/decks/waves-abc/view')
    expect(methods).toEqual(['POST'])
  })

  it('resolves quietly when the server refuses', async () => {
    mockFetchRoutes({
      '/api/decks/waves-abc/view': () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'Gone' } },
      }),
    })

    // The reader is not the person who needs to know a count was lost, and a
    // rejection here would reach the viewer page as an unhandled error.
    await expect(recordDeckView('waves-abc')).resolves.toBeUndefined()
  })

  it('resolves quietly when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    await expect(recordDeckView('waves-abc')).resolves.toBeUndefined()
  })
})
