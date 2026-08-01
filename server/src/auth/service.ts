/**
 * Auth orchestration (SPEC AUTH-1/AUTH-2) used by the auth routes.
 * Wrong-password and unknown-email both yield the same invalid_credentials
 * error so login cannot be used to enumerate accounts. Banned emails
 * (admin moderation) can neither register nor sign in; the ban check on
 * login runs only after credentials verify, so probing a third-party
 * email never reveals its ban status.
 */
import type { Locale, SafeUser } from '@slide-machine/shared'
import { UserModel, toUserDto } from '../models/user'
import { isEmailBanned } from '../models/banned-email'
import { HttpError } from '../middleware/error'
import type { GoogleProfile } from './google'
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

const bannedError = () =>
  new HttpError(403, 'account_banned', 'This account has been banned')

export const register = async (
  email: string,
  password: string,
  displayName: string,
  /** Interface language detected in the browser (TECH-12); omitted
   * leaves the account on the schema default. */
  locale?: Locale,
): Promise<AuthResult> => {
  if (await isEmailBanned(email)) throw bannedError()
  const passwordHash = await hashPassword(password)
  try {
    const user = await UserModel.create({
      email,
      displayName,
      passwordHash,
      ...(locale ? { locale } : {}),
    })
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
  if (await isEmailBanned(user.email)) throw bannedError()
  return {
    user: toUserDto(user),
    accessToken: await signAccessToken(user._id.toString()),
    refreshRaw: await issueRefreshToken(user._id.toString()),
  }
}

/**
 * Signs a user in from a verified Google profile (AUTH-1), creating the
 * account on first sign-in. A verified email maps to a single account, so
 * the resolution order is: existing Google link, then a matching account
 * to link Google onto, then a brand-new account.
 */
export const loginWithGoogle = async (
  profile: GoogleProfile,
): Promise<AuthResult> => {
  // Google only returns verified emails for real accounts, but guard
  // anyway: an unverified email must not silently claim someone's account
  if (!profile.emailVerified) {
    throw new HttpError(
      401,
      'google_email_unverified',
      'Your Google email is not verified',
    )
  }

  const email = profile.email.toLowerCase().trim()
  if (await isEmailBanned(email)) throw bannedError()
  let user = await UserModel.findOne({ googleId: profile.googleId })

  if (!user) {
    const existing = await UserModel.findOne({ email })
    if (existing) {
      // Same verified email as a password (or other) account — link, not duplicate
      existing.googleId = profile.googleId
      if (!existing.avatarUrl && profile.picture)
        existing.avatarUrl = profile.picture
      user = await existing.save()
    } else {
      user = await UserModel.create({
        email,
        displayName: profile.name?.trim() || email.split('@')[0],
        googleId: profile.googleId,
        // Google-verified email needs no separate verification (AUTH-1)
        emailVerified: true,
        avatarUrl: profile.picture,
      })
    }
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
