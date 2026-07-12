/**
 * API fetch wrapper: attaches the Bearer token, parses the shared error
 * shape into a typed ApiError, and transparently retries exactly once
 * after a silent refresh when a 401 arrives.
 */
import type { ApiErrorBody } from '@slide-machine/shared'
import { config } from '../config'
import { getAccessToken, refreshSession } from '../auth/token'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiFetch = async <T>(
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<T> => {
  const headers = new Headers(init.headers)
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  // FormData sets its own multipart boundary; only JSON is defaulted
  if (
    init.body != null &&
    !(init.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${config.apiBaseUrl}${path}`, { ...init, headers })

  if (res.status === 401 && retryOn401) {
    const refreshed = await refreshSession()
    if (refreshed) return apiFetch<T>(path, init, false)
  }

  if (!res.ok) {
    let body: ApiErrorBody | undefined
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      body = undefined
    }
    throw new ApiError(
      res.status,
      body?.error.code ?? 'unknown_error',
      body?.error.message ?? res.statusText,
      body?.error.details,
    )
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
