/**
 * Refresh-token session store operations (SPEC AUTH-2). Tokens rotate on
 * every refresh; the outgoing token keeps a short grace window so two
 * tabs refreshing simultaneously don't log each other out. Expiry is
 * always checked in the query — the TTL index only garbage-collects.
 */
import { RefreshTokenModel } from '../models/refresh-token'
import { env } from '../config/env'
import { generateRefreshToken, hashRefreshToken } from './tokens'

/** Creates a session and returns the raw token (only ever held by the client). */
export const issueRefreshToken = async (userId: string): Promise<string> => {
  const raw = generateRefreshToken()
  await RefreshTokenModel.create({
    userId,
    tokenHash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
  })
  return raw
}

/**
 * Exchanges a valid refresh token for a new one, shortening the old
 * token's life to the grace window. Returns null for unknown/expired tokens.
 */
export const rotateRefreshToken = async (
  raw: string,
): Promise<{ userId: string; newRaw: string } | null> => {
  const now = new Date()
  const current = await RefreshTokenModel.findOne({
    tokenHash: hashRefreshToken(raw),
    expiresAt: { $gt: now },
  })
  if (!current) return null

  const userId = current.userId.toString()
  const newRaw = await issueRefreshToken(userId)

  const graceEnd = new Date(now.getTime() + env.REFRESH_GRACE_SECONDS * 1000)
  if (current.expiresAt > graceEnd) {
    current.expiresAt = graceEnd
    await current.save()
  }

  return { userId, newRaw }
}

/** Deletes the session for the presented token. Idempotent. */
export const revokeRefreshToken = async (raw: string): Promise<void> => {
  await RefreshTokenModel.deleteOne({ tokenHash: hashRefreshToken(raw) })
}
