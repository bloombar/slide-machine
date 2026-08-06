/**
 * Issuing and redeeming the single-use links the app mails (AUTH-3/AUTH-4).
 *
 * The raw token exists only in the message that leaves the server; what is
 * stored is an HMAC of it, keyed by purpose, so the database holds nothing
 * that can be replayed and a verification link cannot be presented as a
 * password reset.
 *
 * Redeeming deletes the token before its effect is applied, which is what
 * makes a link single-use even if it is clicked twice — a mail client that
 * pre-fetches links cannot spend it and leave the user with a dead one,
 * because the second attempt simply finds nothing.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AuthTokenModel, type AuthTokenPurpose } from '../models/auth-token'
import { env } from '../config/env'

/** How long a mailed link stays good, by what it is for. Verification is
 * generous because people read mail hours later; a reset is short because it
 * is the stronger capability of the two. */
const TTL_SECONDS: Record<AuthTokenPurpose, number> = {
  'verify-email': 24 * 60 * 60,
  'password-reset': 60 * 60,
}

/** The stored form of a token. Purpose is inside the HMAC, not beside it, so
 * a token is only ever valid for the one thing it was issued for. */
const hashToken = (raw: string, purpose: AuthTokenPurpose): string =>
  createHmac('sha256', env.JWT_SECRET).update(`${purpose}:${raw}`).digest('hex')

/**
 * Issues a token for one user and purpose, returning the raw value to mail.
 * Any earlier token for the same purpose is dropped: asking for a new link
 * should make the old one stop working, not leave two live.
 */
export const issueAuthToken = async (
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<string> => {
  await AuthTokenModel.deleteMany({ userId, purpose })
  const raw = randomBytes(32).toString('base64url')
  await AuthTokenModel.create({
    userId,
    purpose,
    tokenHash: hashToken(raw, purpose),
    expiresAt: new Date(Date.now() + TTL_SECONDS[purpose] * 1000),
  })
  return raw
}

/**
 * Spends a token, returning whose it was — or null when it is unknown,
 * expired, or already used. Callers treat every null the same way rather than
 * saying which, so a bad link never reports whether it once existed.
 */
export const consumeAuthToken = async (
  raw: string,
  purpose: AuthTokenPurpose,
): Promise<string | null> => {
  if (!raw) return null
  const doc = await AuthTokenModel.findOneAndDelete({
    tokenHash: hashToken(raw, purpose),
    expiresAt: { $gt: new Date() },
  })
  return doc ? doc.userId.toString() : null
}

/** Drops every token a user holds for one purpose — used once the thing the
 * token was for has happened by another route. */
export const revokeAuthTokens = async (
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<void> => {
  await AuthTokenModel.deleteMany({ userId, purpose })
}

/** Whether two tokens are the same, without leaking where they diverge.
 * Exported for tests that need to compare without re-hashing. */
export const sameToken = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
