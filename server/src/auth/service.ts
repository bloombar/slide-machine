/**
 * Auth orchestration (SPEC AUTH-1/AUTH-2) used by the auth routes.
 * Wrong-password and unknown-email both yield the same invalid_credentials
 * error so login cannot be used to enumerate accounts.
 */
import type { SafeUser } from '@slide-machine/shared'
import { UserModel, toUserDto } from '../models/user'
import { HttpError } from '../middleware/error'
import { hashPassword, verifyPassword } from './password'
import { signAccessToken } from './tokens'
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from './refresh-store'

export interface AuthResult {
  user: SafeUser
  accessToken: string
  refreshRaw: string
}

export const register = async (
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> => {
  const passwordHash = await hashPassword(password)
  try {
    const user = await UserModel.create({ email, displayName, passwordHash })
    return {
      user: toUserDto(user),
      accessToken: await signAccessToken(user._id.toString()),
      refreshRaw: await issueRefreshToken(user._id.toString()),
    }
  } catch (error) {
    // Unique-index race: two simultaneous registrations for one email
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    ) {
      throw new HttpError(
        409,
        'email_taken',
        'An account with this email already exists',
      )
    }
    throw error
  }
}

export const login = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  const user = await UserModel.findOne({
    email: email.toLowerCase().trim(),
  }).select('+passwordHash')
  if (
    !user?.passwordHash ||
    !(await verifyPassword(user.passwordHash, password))
  ) {
    throw new HttpError(
      401,
      'invalid_credentials',
      'Incorrect email or password',
    )
  }
  return {
    user: toUserDto(user),
    accessToken: await signAccessToken(user._id.toString()),
    refreshRaw: await issueRefreshToken(user._id.toString()),
  }
}

export const refresh = async (
  refreshRaw: string | undefined,
): Promise<AuthResult> => {
  const invalid = new HttpError(
    401,
    'invalid_refresh_token',
    'Session expired — sign in again',
  )
  if (!refreshRaw) throw invalid

  const rotated = await rotateRefreshToken(refreshRaw)
  if (!rotated) throw invalid

  const user = await UserModel.findById(rotated.userId)
  if (!user) throw invalid

  return {
    user: toUserDto(user),
    accessToken: await signAccessToken(rotated.userId),
    refreshRaw: rotated.newRaw,
  }
}

/** Idempotent: succeeds whether or not a valid session token is presented. */
export const logout = async (refreshRaw: string | undefined): Promise<void> => {
  if (refreshRaw) await revokeRefreshToken(refreshRaw)
}
