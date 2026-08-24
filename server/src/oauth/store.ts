/**
 * Minting, checking and withdrawing the tokens an assistant holds
 * (docs/MCP.md §5).
 *
 * Everything here follows one rule the rest of the auth code already follows:
 * the raw token exists only in the response that carries it away, and only its
 * HMAC is ever written down. What is stored cannot be replayed.
 *
 * Two lifetimes, doing different jobs:
 *
 *   - **Access tokens are short.** A token sitting in a third-party
 *     assistant's storage is the one risk this feature cannot design away
 *     (docs/MCP.md §5.4) — it lives on a laptop or a vendor's servers, and if
 *     either is compromised, someone has this account's lectures until the
 *     token dies or is revoked. An hour bounds that without making the
 *     assistant re-ask the user.
 *   - **Refresh tokens are long**, so a connection survives without the user
 *     re-approving it weekly, and are rotated on use so a stolen one is worth
 *     a single exchange rather than a standing key.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { OAuthTokenModel, type OAuthTokenKind } from '../models/oauth-token'
import { env } from '../config/env'

/** One hour. Long enough for a working session, short enough to bound a leak. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
/** Thirty days. A connection the user has not revoked keeps working. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30
/** Five minutes: the walk from the consent screen back to the assistant. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60

/**
 * Keyed by the refresh secret rather than the JWT one: these are opaque
 * strings verified by lookup, which is what that key already protects.
 */
export const hashToken = (raw: string): string =>
  createHmac('sha256', env.JWT_REFRESH_SECRET).update(raw).digest('hex')

/** 256 bits of randomness, URL-safe. Never derived from anything guessable. */
export const generateToken = (): string => randomBytes(32).toString('base64url')

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** What a verified access token turned out to mean. */
export interface VerifiedToken {
  userId: string
  clientId: string
  scopes: string[]
  resource?: string
  expiresAt: Date
}

const store = async (
  kind: OAuthTokenKind,
  raw: string,
  grant: {
    clientId: string
    userId: string
    scopes: string[]
    resource?: string
  },
  ttlSeconds: number,
): Promise<void> => {
  await OAuthTokenModel.create({
    tokenHash: hashToken(raw),
    kind,
    clientId: grant.clientId,
    userId: new Types.ObjectId(grant.userId),
    scopes: grant.scopes,
    resource: grant.resource,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  })
}

/** Issues a fresh access/refresh pair for one assistant acting for one user. */
export const issueTokens = async (grant: {
  clientId: string
  userId: string
  scopes: string[]
  resource?: string
}): Promise<IssuedTokens> => {
  const accessToken = generateToken()
  const refreshToken = generateToken()
  await Promise.all([
    store('access', accessToken, grant, ACCESS_TOKEN_TTL_SECONDS),
    store('refresh', refreshToken, grant, REFRESH_TOKEN_TTL_SECONDS),
  ])
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  }
}

/**
 * What this access token means, or null.
 *
 * Expiry is checked in the query rather than after it. The TTL index only
 * garbage-collects, and it runs about once a minute — long enough for an
 * expired token to still be sitting in the collection when it is presented.
 */
export const verifyToken = async (
  raw: string,
): Promise<VerifiedToken | null> => {
  const doc = await OAuthTokenModel.findOne({
    tokenHash: hashToken(raw),
    kind: 'access',
    expiresAt: { $gt: new Date() },
  })
  if (!doc) return null
  return {
    userId: doc.userId.toString(),
    clientId: doc.clientId,
    scopes: doc.scopes,
    resource: doc.resource,
    expiresAt: doc.expiresAt,
  }
}

/**
 * Spends a refresh token and issues a new pair, or returns null.
 *
 * Rotation, not reuse: the presented token is deleted in the same step it is
 * accepted, so it is worth exactly one exchange. `clientId` is checked too —
 * a refresh token is bound to the assistant it was issued to, and one client
 * must not be able to redeem another's.
 */
export const rotateTokens = async (
  raw: string,
  clientId: string,
  narrowedScopes?: string[],
): Promise<IssuedTokens | null> => {
  const doc = await OAuthTokenModel.findOneAndDelete({
    tokenHash: hashToken(raw),
    kind: 'refresh',
    clientId,
    expiresAt: { $gt: new Date() },
  })
  if (!doc) return null

  // A client may ask for less than it holds, never for more: anything outside
  // the original grant is dropped rather than treated as an error, which is
  // what RFC 6749 §6 requires.
  const scopes = narrowedScopes?.length
    ? narrowedScopes.filter(scope => doc.scopes.includes(scope))
    : doc.scopes

  return issueTokens({
    clientId: doc.clientId,
    userId: doc.userId.toString(),
    scopes,
    resource: doc.resource,
  })
}

/** Forgets one token. Idempotent, as RFC 7009 requires. */
export const revokeToken = async (raw: string): Promise<void> => {
  await OAuthTokenModel.deleteOne({ tokenHash: hashToken(raw) })
}

/**
 * Disconnects one assistant from one account: every token that pair ever
 * issued, access and refresh alike.
 *
 * This is what the connected-assistants list's Disconnect button does, and
 * why it is worth more than revoking the presented token — the user's intent
 * is "this assistant stops having access", not "this particular string stops
 * working".
 */
export const disconnect = async (
  userId: string,
  clientId: string,
): Promise<number> => {
  const { deletedCount } = await OAuthTokenModel.deleteMany({
    userId: new Types.ObjectId(userId),
    clientId,
  })
  return deletedCount ?? 0
}

/** The assistants currently holding a live token for this account. */
export const connectionsFor = async (
  userId: string,
): Promise<{ clientId: string; scopes: string[]; connectedAt: Date }[]> => {
  const docs = await OAuthTokenModel.find({
    userId: new Types.ObjectId(userId),
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: 1 })

  // One row per assistant, not per token: a client that has refreshed twenty
  // times is one connection to the person reading the list.
  const byClient = new Map<
    string,
    { clientId: string; scopes: string[]; connectedAt: Date }
  >()
  for (const doc of docs) {
    const existing = byClient.get(doc.clientId)
    if (existing) {
      for (const scope of doc.scopes) {
        if (!existing.scopes.includes(scope)) existing.scopes.push(scope)
      }
      continue
    }
    byClient.set(doc.clientId, {
      clientId: doc.clientId,
      scopes: [...doc.scopes],
      connectedAt: doc.createdAt,
    })
  }
  return [...byClient.values()]
}
