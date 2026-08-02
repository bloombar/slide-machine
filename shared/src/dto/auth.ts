/**
 * Auth DTOs (SPEC AUTH-1/AUTH-2). The API never returns passwordHash;
 * SafeUser is the only user shape that crosses the wire.
 */
import type { Locale } from '../types/locale'
import type { User } from '../types/user'

export type SafeUser = Omit<User, 'passwordHash'>

export interface RegisterRequest {
  email: string
  password: string
  displayName: string
  /** Interface language the visitor explicitly picked before signing up
   * (TECH-12), so the choice carries onto the new account. A merely
   * detected language is NOT sent: absent means "follow the browser",
   * which is re-resolved on every visit. */
  locale?: Locale
}

export interface LoginRequest {
  email: string
  password: string
}

/** Returned by register, login, and refresh. The refresh token itself
 * travels only in an httpOnly cookie, never in the body. */
export interface AuthResponse {
  user: SafeUser
  accessToken: string
}

/** Uniform error body returned by the API error handler. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: string[]
  }
}
