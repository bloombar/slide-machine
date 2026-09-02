/**
 * Unit tests for background image pickup: polls until the image arrives,
 * gives up quietly, and respects cancellation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pollSlideImage } from './slides'
import { setAccessToken } from '../auth/token'
import { mockFetchRoutes } from '../test/fetch-mock'

const slide = (imageRef?: string) => ({
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'two-column',
  imageKeywords: ['mitochondria'],
  imageRef,
})

beforeEach(() => {
  setAccessToken('tok')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pollSlideImage', () => {
  it('resolves with the slide once the image lands', async () => {
    let calls = 0
    mockFetchRoutes({
      '/api/actions/slide.get': () => ({
        status: 200,
        body: ++calls < 2 ? slide() : slide('http://img/x.png'),
      }),
    })

    const resolved = await new Promise(resolve => {
      pollSlideImage('s1', resolve, { attempts: 5, fixedDelayMs: 1 })
    })

    expect(resolved).toMatchObject({ imageRef: 'http://img/x.png' })
    expect(calls).toBe(2)
  })

  it('resolves null after exhausting attempts (quiet fallback)', async () => {
    mockFetchRoutes({
      '/api/actions/slide.get': () => ({ status: 200, body: slide() }),
    })

    const resolved = await new Promise(resolve => {
      pollSlideImage('s1', resolve, { attempts: 3, fixedDelayMs: 1 })
    })
    expect(resolved).toBeNull()
  })

  it('keeps polling through transient errors without surfacing them', async () => {
    let calls = 0
    mockFetchRoutes({
      '/api/actions/slide.get': () =>
        ++calls === 1
          ? { status: 500 }
          : { status: 200, body: slide('http://img/y.png') },
    })

    const resolved = await new Promise(resolve => {
      pollSlideImage('s1', resolve, { attempts: 5, fixedDelayMs: 1 })
    })
    expect(resolved).toMatchObject({ imageRef: 'http://img/y.png' })
  })

  it('stops after cancel without calling back', async () => {
    const onResolved = vi.fn()
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/slide.get': () => ({ status: 200, body: slide() }),
    })

    const cancel = pollSlideImage('s1', onResolved, {
      attempts: 50,
      fixedDelayMs: 5,
    })
    cancel()
    await new Promise(r => setTimeout(r, 30))

    expect(onResolved).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  // IMG-1: the default schedule (no fixedDelayMs override) should check
  // promptly and back off, not sit on a fixed 1.5s grid. These use fake
  // timers so the assertions are about scheduling, not wall clock.
  describe('default backoff schedule (no fixedDelayMs override)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('dispatches the first slide.get before 300ms of virtual time', async () => {
      const { fetchMock } = mockFetchRoutes({
        '/api/actions/slide.get': () => ({ status: 200, body: slide() }),
      })

      pollSlideImage('s1', vi.fn())

      // Advance to just under 300ms: today's fixed 1500ms interval would
      // still have made zero requests here.
      await vi.advanceTimersByTimeAsync(299)
      expect(fetchMock.mock.calls.length).toBe(1)
    })

    it('still gives up only after at least 18s of virtual time', async () => {
      const onResolved = vi.fn()
      mockFetchRoutes({
        '/api/actions/slide.get': () => ({ status: 200, body: slide() }),
      })

      pollSlideImage('s1', onResolved)

      // Just before the 18s window: must not have resolved (null) yet.
      await vi.advanceTimersByTimeAsync(17_900)
      expect(onResolved).not.toHaveBeenCalled()

      // Run out the rest of the schedule.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(onResolved).toHaveBeenCalledWith(null)
    })

    it('makes exactly 14 requests over a full unresolved window', async () => {
      const { fetchMock } = mockFetchRoutes({
        '/api/actions/slide.get': () => ({ status: 200, body: slide() }),
      })

      pollSlideImage('s1', vi.fn())
      await vi.advanceTimersByTimeAsync(30_000)

      // Pins the default attempt count exactly: 12 (a revert to the old flat
      // schedule) and runaway inflation (e.g. attempts: 30) both fail this.
      expect(fetchMock.mock.calls.length).toBe(14)
    })
  })
})
