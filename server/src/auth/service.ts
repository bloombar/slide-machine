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
import { consumeAuthToken, revokeAuthTokens } from './one-time-tokens'
import { sendPasswordResetEmail, sendVerificationEmail } from './emails'
import { signAccessToken } from './tokens'
import {
  issueRefreshToken,
  revokeAllSessions,
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
  /** Interface language the visitor explicitly picked before signing up
   * (TECH-12); omitted stores nothing, leaving the account following
   * whatever language the browser asks for. */
  locale?: Locale,
  /** Where the verification link should point (AUTH-3). Omitted skips the
   * mail — the account still exists and can ask for a link later. */
  origin?: string,
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
    // Best-effort, and deliberately awaited: the response tells the client
    // whether to say "check your email", and the send is a local hand-off to
    // the relay rather than a delivery wait.
    if (origin) {
      await sendVerificationEmail(
        user._id.toString(),
        user.email,
        user.displayName,
        origin,
      )
    }
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

/**
 * Marks an address as verified from a mailed link (AUTH-3). The token is
 * spent whether or not the account still exists, so a link never works twice.
 * An unknown or expired token is one error, not several — a link that says
 * "expired" versus "unknown" tells a stranger which tokens once existed.
 */
export const verifyEmail = async (token: string): Promise<SafeUser> => {
  const invalid = new HttpError(
    400,
    'invalid_token',
    'This link is no longer valid. Ask for a new one.',
  )
  const userId = await consumeAuthToken(token, 'verify-email')
  if (!userId) throw invalid
  const user = await UserModel.findById(userId)
  if (!user) throw invalid
  if (!user.emailVerified) {
    user.emailVerified = true
    await user.save()
  }
  return toUserDto(user)
}

/**
 * Mails a fresh verification link to the signed-in user (AUTH-3). Returns
 * whether one was actually sent, so the client can say "check your email"
 * only when it is true. Verifying again is a no-op rather than an error: a
 * user who clicks the link in an old message should not see a failure.
 */
export const resendVerification = async (
  userId: string,
  origin: string,
): Promise<{ sent: boolean; alreadyVerified: boolean }> => {
  const user = await UserModel.findById(userId)
  if (!user)
    throw new HttpError(401, 'unauthorized', 'Account no longer exists')
  if (user.emailVerified) {
    // Nothing to prove, and any outstanding link is now pointless
    await revokeAuthTokens(userId, 'verify-email')
    return { sent: false, alreadyVerified: true }
  }
  const sent = await sendVerificationEmail(
    userId,
    user.email,
    user.displayName,
    origin,
  )
  return { sent, alreadyVerified: false }
}

/**
 * Starts "I forgot my password" (AUTH-4).
 *
 * Returns nothing and never reports whether the address has an account: the
 * caller answers the same way either way, so this form cannot be used to
 * discover who is registered. An account with no password (Google-only) is
 * skipped for the same reason — silently, since saying "use Google instead"
 * would confirm the address.
 */
export const requestPasswordReset = async (
  email: string,
  origin: string,
): Promise<void> => {
  const user = await UserModel.findOne({
    email: email.toLowerCase().trim(),
  }).select('+passwordHash')
  if (!user?.passwordHash) return
  if (await isEmailBanned(user.email)) return
  await sendPasswordResetEmail(
    user._id.toString(),
    user.email,
    user.displayName,
    origin,
  )
}

/**
 * Finishes a reset (AUTH-4): sets the new password and signs the account out
 * everywhere, because whoever asked for the reset may be locking someone else
 * out — a stolen session must not survive the recovery that was meant to end
 * it. The caller is left signed out too, and signs in with the new password.
 */
export const resetPassword = async (
  token: string,
  password: string,
): Promise<void> => {
  const invalid = new HttpError(
    400,
    'invalid_token',
    'This link is no longer valid. Ask for a new one.',
  )
  const userId = await consumeAuthToken(token, 'password-reset')
  if (!userId) throw invalid
  const user = await UserModel.findById(userId)
  if (!user) throw invalid
  if (await isEmailBanned(user.email)) throw bannedError()

  user.passwordHash = await hashPassword(password)
  // Reaching a mailed link proves the address as surely as the verification
  // link does, so a reset settles verification too (AUTH-3).
  user.emailVerified = true
  await user.save()
  await revokeAllSessions(userId)
  await revokeAuthTokens(userId, 'verify-email')
}
