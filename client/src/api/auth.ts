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

/**
 * Confirms an address from a mailed link (AUTH-3). Deliberately outside the
 * 401-refresh retry: the token in the URL is the credential, and the visitor
 * may not be signed in at all.
 */
export const verifyEmail = (token: string): Promise<SafeUser> =>
  apiFetch<SafeUser>(
    '/api/auth/verify-email',
    { method: 'POST', body: JSON.stringify({ token }) },
    false,
  )

/** Asks for a fresh verification link (AUTH-3). Signed in, so the server
 * knows which address to send it to. */
export const resendVerification = (): Promise<{
  sent: boolean
  alreadyVerified: boolean
}> =>
  apiFetch<{ sent: boolean; alreadyVerified: boolean }>(
    '/api/auth/verify-email/resend',
    { method: 'POST' },
  )

/**
 * Starts "I forgot my password" (AUTH-4). Always succeeds, whether or not the
 * address has an account — the server answers the same way either way so the
 * form cannot be used to find out who is registered.
 */
export const forgotPassword = (email: string): Promise<void> =>
  apiFetch<void>(
    '/api/auth/forgot-password',
    { method: 'POST', body: JSON.stringify({ email }) },
    false,
  )

/** Sets a new password from a mailed link (AUTH-4). Every session ends,
 * including this browser's, so the caller signs in afterwards. */
export const resetPassword = (token: string, password: string): Promise<void> =>
  apiFetch<void>(
    '/api/auth/reset-password',
    { method: 'POST', body: JSON.stringify({ token, password }) },
    false,
  )
