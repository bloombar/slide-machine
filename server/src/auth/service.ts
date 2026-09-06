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
import { claimShareInvites } from '../lib/share-invites'
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

/**
 * Claims pending share invitations (SHARE-3) for an account whose address is
 * now **proven** — confirmed by AUTH-3's link, proven by completing a
 * password reset sent to it, or verified by Google.
 *
 * Proof is the point. Anyone can register any address, so claiming at
 * registration would hand a lecture invited to a colleague's work address to
 * whoever typed it into the sign-up form first. Every place that decides an
 * address is proven calls this; miss one and the invitation is stranded
 * forever, since the invited person has no way to ask again.
 *
 * Safe to call when there is nothing to claim, and safe to call twice — it
 * matches on the invitations still stored. Failures are swallowed: the
 * account is proven either way, and an unclaimed invitation stays on the
 * lecture for the next attempt.
 */
const claimInvitesQuietly = async (
  userId: string,
  email: string,
): Promise<void> => {
  try {
    await claimShareInvites(userId, email)
  } catch (error) {
    console.warn('Could not claim pending share invitations:', error)
  }
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
    // Started, not awaited. Handing a message to a relay is not a local
    // hand-off — a relay that is refusing logins or answering slowly takes
    // seconds to fail, and awaiting it here would make that the sign-up's
    // latency and, past a gateway timeout, its error. Nothing in the response
    // reports the send, so there is nothing to wait for: the account page
    // shows an unconfirmed address and offers another link, and *that* path
    // reports truthfully whether one went out.
    if (origin) {
      void sendVerificationEmail(
        user._id.toString(),
        user.email,
        user.displayName,
        origin,
      ).catch(error => {
        // sendVerificationEmail swallows its own failures; this is only so a
        // future edit above its try block cannot become an unhandled rejection.
        console.warn('Could not send the verification email:', error)
      })
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
      // Google has verified this address, so an account that never confirmed
      // it is confirmed by signing in this way — and its invitations are
      // claimed like any other proven address (AUTH-1, SHARE-3).
      existing.emailVerified = true
      user = await existing.save()
      await claimInvitesQuietly(user._id.toString(), user.email)
    } else {
      user = await UserModel.create({
        email,
        displayName: profile.name?.trim() || email.split('@')[0],
        googleId: profile.googleId,
        // Google-verified email needs no separate verification (AUTH-1)
        emailVerified: true,
        avatarUrl: profile.picture,
      })
      // Google returns only verified addresses (checked above), so this
      // account has already proved the one thing an invitation waits for —
      // no confirmation step to route through (SHARE-3).
      await claimInvitesQuietly(user._id.toString(), user.email)
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
  // Outside the branch above on purpose: an address can be proven elsewhere
  // (a completed password reset) and an invitation arrive afterwards, so
  // this must claim for an already-confirmed account too (SHARE-3).
  await claimInvitesQuietly(user._id.toString(), user.email)
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
  // Proven, so anything invited to this address is claimed here as well —
  // otherwise a recovery would leave the invitation stranded with no link
  // left to click (SHARE-3).
  await claimInvitesQuietly(userId, user.email)
  await revokeAllSessions(userId)
  await revokeAuthTokens(userId, 'verify-email')
}
