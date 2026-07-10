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
      pollSlideImage('s1', resolve, { attempts: 5, intervalMs: 1 })
    })

    expect(resolved).toMatchObject({ imageRef: 'http://img/x.png' })
    expect(calls).toBe(2)
  })

  it('resolves null after exhausting attempts (quiet fallback)', async () => {
    mockFetchRoutes({
      '/api/actions/slide.get': () => ({ status: 200, body: slide() }),
    })

    const resolved = await new Promise(resolve => {
      pollSlideImage('s1', resolve, { attempts: 3, intervalMs: 1 })
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
      pollSlideImage('s1', resolve, { attempts: 5, intervalMs: 1 })
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
      intervalMs: 5,
    })
    cancel()
    await new Promise(r => setTimeout(r, 30))

    expect(onResolved).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.length).toBe(0)
  })
})
