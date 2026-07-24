/**
 * API fetch wrapper: attaches the Bearer token, parses the shared error
 * shape into a typed ApiError, and transparently retries exactly once
 * after a silent refresh when a 401 arrives. apiFetch parses JSON;
 * apiFetchBlob returns raw bytes for file downloads (e.g. CSV export).
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

/** Shared request core: token attachment, one silent-refresh retry on
 * 401, and error-shape parsing. Resolves with an ok Response. */
const apiRequest = async (
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<Response> => {
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
    if (refreshed) return apiRequest(path, init, false)
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

  return res
}

export const apiFetch = async <T>(
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<T> => {
  const res = await apiRequest(path, init, retryOn401)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Like apiFetch, but resolves with the raw response body as a Blob —
 * for authenticated file downloads that a plain <a href> can't make. */
export const apiFetchBlob = async (
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<Blob> => {
  const res = await apiRequest(path, init, retryOn401)
  return res.blob()
}
