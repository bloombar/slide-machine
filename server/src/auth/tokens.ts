/**
 * Token primitives (SPEC AUTH-2). Access tokens are short-lived HS256
 * JWTs (jose). Refresh tokens are opaque random strings; only their
 * HMAC (keyed by JWT_REFRESH_SECRET) is ever persisted, so a database
 * leak cannot forge or replay a session.
 */
import { SignJWT, jwtVerify } from 'jose'
import { createHmac, randomBytes } from 'node:crypto'
import { env } from '../config/env'

const accessKey = new TextEncoder().encode(env.JWT_SECRET)

export const signAccessToken = async (
  userId: string,
  ttlSeconds: number = env.JWT_ACCESS_TTL_SECONDS,
): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(accessKey)

/** Throws (jose JWTExpired / JWSSignatureVerificationFailed) on bad tokens. */
export const verifyAccessToken = async (
  token: string,
): Promise<{ userId: string }> => {
  const { payload } = await jwtVerify(token, accessKey)
  if (!payload.sub) throw new Error('Access token has no subject')
  return { userId: payload.sub }
}

export const generateRefreshToken = (): string =>
  randomBytes(32).toString('base64url')

export const hashRefreshToken = (raw: string): string =>
  createHmac('sha256', env.JWT_REFRESH_SECRET).update(raw).digest('hex')
