/**
 * Auth DTOs (SPEC AUTH-1/AUTH-2). The API never returns passwordHash;
 * SafeUser is the only user shape that crosses the wire.
 */
import type { User } from '../types/user'

export type SafeUser = Omit<User, 'passwordHash'>

export interface RegisterRequest {
  email: string
  password: string
  displayName: string
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
