/**
 * Unit tests for the API wrapper: typed errors, the single 401-refresh
 * retry, and single-flight refresh under concurrency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AuthResponse } from '@slide-machine/shared'
import { apiFetch, ApiError } from './http'
import { setAccessToken } from '../auth/token'
import { mockFetchRoutes } from '../test/fetch-mock'

const authFixture = {
  user: { id: 'u1', email: 'a@b.com' },
  accessToken: 'fresh-token',
} as unknown as AuthResponse

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('parses the shared error body into a typed ApiError', async () => {
    mockFetchRoutes({
      '/api/thing': () => ({
        status: 400,
        body: {
          error: {
            code: 'invalid_input',
            message: 'Bad',
            details: ['title: required'],
          },
        },
      }),
    })

    const err = (await apiFetch('/api/thing').catch(e => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('invalid_input')
    expect(err.details).toEqual(['title: required'])
  })

  it('retries once after a successful refresh on 401', async () => {
    let thingCalls = 0
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 200, body: authFixture }),
      '/api/thing': () =>
        ++thingCalls === 1 ? { status: 401 } : { status: 200, body: { ok: 1 } },
    })

    expect(await apiFetch('/api/thing')).toEqual({ ok: 1 })
    expect(thingCalls).toBe(2)
  })

  it('surfaces the 401 when refresh fails, without retrying', async () => {
    let thingCalls = 0
    mockFetchRoutes({
      '/api/auth/refresh': () => ({ status: 401 }),
      '/api/thing': () => {
        thingCalls++
        return {
          status: 401,
          body: { error: { code: 'unauthorized', message: 'No' } },
        }
      },
    })

    const err = (await apiFetch('/api/thing').catch(e => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(thingCalls).toBe(1)
  })

  it('shares one refresh across concurrent 401s (single-flight)', async () => {
    let refreshCalls = 0
    let aCalls = 0
    let bCalls = 0
    mockFetchRoutes({
      '/api/auth/refresh': () => {
        refreshCalls++
        return { status: 200, body: authFixture }
      },
      '/api/a': () =>
        ++aCalls === 1 ? { status: 401 } : { status: 200, body: { a: 1 } },
      '/api/b': () =>
        ++bCalls === 1 ? { status: 401 } : { status: 200, body: { b: 1 } },
    })

    const [a, b] = await Promise.all([apiFetch('/api/a'), apiFetch('/api/b')])
    expect(a).toEqual({ a: 1 })
    expect(b).toEqual({ b: 1 })
    expect(refreshCalls).toBe(1)
  })

  it('attaches the Bearer token when present', async () => {
    setAccessToken('tok-123')
    const { fetchMock } = mockFetchRoutes({
      '/api/thing': () => ({ status: 200, body: {} }),
    })

    await apiFetch('/api/thing')

    const init = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer tok-123',
    )
  })
})
