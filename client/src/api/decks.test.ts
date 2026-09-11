/**
 * Unit tests for the view beacon (EVAL-7) and the depth-report beacon
 * (EVAL-7 depth).
 *
 * Two things matter about `recordDeckView` and neither is the happy path: it
 * must reach the right endpoint as a POST, and it must never let a failed
 * statistic surface as a rejected promise in the page that called it. What
 * matters about `reportReadingDepth` is where it sends the report — via
 * `sendBeacon` when available, `fetch` otherwise — since nothing reads its
 * response either way.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { recordDeckView, reportReadingDepth } from './decks'
import { mockFetchRoutes } from '../test/fetch-mock'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recordDeckView', () => {
  it('posts to the lecture it names and hands back its completion key', async () => {
    const methods: (string | undefined)[] = []
    const { calls } = mockFetchRoutes({
      '/api/decks/waves-abc/view': init => {
        methods.push(init?.method)
        return { status: 200, body: { completionKey: 'a'.repeat(64) } }
      },
    })

    const result = await recordDeckView('waves-abc')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/api/decks/waves-abc/view')
    expect(methods).toEqual(['POST'])
    expect(result).toEqual({ completionKey: 'a'.repeat(64) })
  })

  it('resolves with no key when the server refuses', async () => {
    mockFetchRoutes({
      '/api/decks/waves-abc/view': () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'Gone' } },
      }),
    })

    // The reader is not the person who needs to know a count was lost, and a
    // rejection here would reach the viewer page as an unhandled error.
    await expect(recordDeckView('waves-abc')).resolves.toEqual({
      completionKey: null,
    })
  })

  it('resolves with no key when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    await expect(recordDeckView('waves-abc')).resolves.toEqual({
      completionKey: null,
    })
  })

  it('resolves with no key when the opening was rate-limited (204, no body)', async () => {
    // The route answers 204 whatever happens except a recorded opening —
    // there is then no key to hand back.
    mockFetchRoutes({
      '/api/decks/waves-abc/view': () => ({ status: 204, body: null }),
    })

    await expect(recordDeckView('waves-abc')).resolves.toEqual({
      completionKey: null,
    })
  })
})

describe('reportReadingDepth', () => {
  it('sends the report via sendBeacon when it is available', () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => true)
    vi.stubGlobal('navigator', { sendBeacon })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    reportReadingDepth('waves-abc', {
      completionKey: 'a'.repeat(64),
      slidesReached: 3,
      activeMs: 45_000,
    })

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const [url, blob] = sendBeacon.mock.calls[0]!
    expect(String(url)).toContain('/api/decks/waves-abc/view/complete')
    expect(blob).toBeInstanceOf(Blob)
    // Never reaches for fetch once sendBeacon accepted the report.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to a keepalive fetch when sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', {})
    const { calls } = mockFetchRoutes({
      '/api/decks/waves-abc/view/complete': () => ({ status: 204 }),
    })

    reportReadingDepth('waves-abc', {
      completionKey: 'a'.repeat(64),
      slidesReached: 3,
      activeMs: 45_000,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/api/decks/waves-abc/view/complete')
  })

  it('falls back to fetch when sendBeacon reports the report was refused', () => {
    const sendBeacon = vi.fn(() => false)
    vi.stubGlobal('navigator', { sendBeacon })
    const { calls } = mockFetchRoutes({
      '/api/decks/waves-abc/view/complete': () => ({ status: 204 }),
    })

    reportReadingDepth('waves-abc', {
      completionKey: 'a'.repeat(64),
      slidesReached: 3,
      activeMs: 45_000,
    })

    expect(calls).toHaveLength(1)
  })

  it('never rejects into the caller when the fallback fetch fails', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    // Synchronous call: nothing to await, and nothing here may throw.
    expect(() =>
      reportReadingDepth('waves-abc', {
        completionKey: 'a'.repeat(64),
        slidesReached: 3,
        activeMs: 45_000,
      }),
    ).not.toThrow()
  })
})
