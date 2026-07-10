/**
 * In-memory access-token holder + single-flight session refresh.
 * The access token never touches storage (P-3); the refresh token lives
 * in an httpOnly cookie the browser sends to /api/auth automatically.
 * Single-flight ensures concurrent callers (StrictMode double-mount,
 * simultaneous 401 retries) share one /refresh request.
 */
import type { AuthResponse } from '@slide-machine/shared'
import { config } from '../config'

let accessToken: string | null = null

export const getAccessToken = (): string | null => accessToken

export const setAccessToken = (token: string | null): void => {
  accessToken = token
}

let refreshInFlight: Promise<AuthResponse | null> | null = null

const doRefresh = async (): Promise<AuthResponse | null> => {
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/auth/refresh`, {
      method: 'POST',
    })
    if (!res.ok) return null
    const body = (await res.json()) as AuthResponse
    setAccessToken(body.accessToken)
    return body
  } catch {
    return null
  }
}

/** Exchanges the refresh cookie for a fresh session; null if signed out. */
export const refreshSession = (): Promise<AuthResponse | null> => {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}
