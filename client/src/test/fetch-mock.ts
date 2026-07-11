/**
 * Tiny URL-routed fetch mock for client tests: map path fragments to
 * handlers, count calls, and stub the global fetch in one line.
 */
import { vi } from 'vitest'

type Handler = (init?: RequestInit) => { status: number; body?: unknown }

export const mockFetchRoutes = (routes: Record<string, Handler>) => {
  const calls: string[] = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      const key = Object.keys(routes).find(k => url.includes(k))
      if (!key) throw new Error(`Unmocked fetch: ${url}`)
      const { status, body } = routes[key]!(init)
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as Response
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}
