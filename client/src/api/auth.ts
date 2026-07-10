/**
 * Typed auth API calls. These bypass the automatic 401-refresh retry —
 * a failed login must surface as-is, not trigger a refresh loop.
 */
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  SafeUser,
} from '@slide-machine/shared'
import { apiFetch } from './http'
import { setAccessToken } from '../auth/token'

export const register = async (
  input: RegisterRequest,
): Promise<AuthResponse> => {
  const res = await apiFetch<AuthResponse>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify(input) },
    false,
  )
  setAccessToken(res.accessToken)
  return res
}

export const login = async (input: LoginRequest): Promise<AuthResponse> => {
  const res = await apiFetch<AuthResponse>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify(input) },
    false,
  )
  setAccessToken(res.accessToken)
  return res
}

export const logout = async (): Promise<void> => {
  await apiFetch<void>('/api/auth/logout', { method: 'POST' }, false)
  setAccessToken(null)
}

export const me = (): Promise<SafeUser> => apiFetch<SafeUser>('/api/auth/me')
