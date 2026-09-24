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
import { OAuthClientModel } from '../models/oauth-client'
import { UserModel } from '../models/user'
import { env } from '../config/env'
import { mailerAvailable, sendMail } from '../lib/mailer'

/** One hour. Long enough for a working session, short enough to bound a leak. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
/**
 * Six months — and it is an **idle** timeout, not a lifetime.
 *
 * Rotation issues a fresh token on every exchange, so the clock restarts each
 * time an assistant is used: a connection in regular use never expires at all.
 * What this actually bounds is a connection nobody has touched in half a year,
 * which is the one worth ending — "I tried an assistant once and forgot about
 * it" is a live key nobody is watching, and if that vendor is breached later,
 * nobody is looking.
 *
 * Six rather than one month because this application runs on an academic
 * calendar. A winter break is four to six weeks and a summer is three months,
 * so a month would disconnect instructors over every holiday — at exactly the
 * moment they are least inclined to work out why. Six months clears any break
 * while still lapsing something genuinely abandoned. It is the window Google
 * settled on for the same problem.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 182
/**
 * Five minutes: the walk from the consent screen back to the assistant.
 *
 * Short because an authorization code is a bearer credential in a URL — it
 * travels through a browser redirect, lands in history, and may be logged
 * along the way. RFC 6749 asks for ten minutes at most; five is comfortable
 * for a redirect and leaves little room to catch one in flight.
 */
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60

/**
 * Fifteen minutes for the *pending* half — the time a person has to read the
 * consent screen and decide.
 *
 * A separate number because it measures something else entirely. Five minutes
 * is a machine round-trip; this is a human being asked to weigh what an
 * assistant is about to be allowed to do, possibly after signing in first, on
 * a screen they have never seen before. Sharing one clock meant a careful
 * reader ran out of time, and — worse — that taking four minutes to decide
 * left the code only one minute to be exchanged.
 *
 * The two are re-based on approval: the pending window ends when the answer
 * comes, and the code gets its own full five minutes from that moment.
 */
export const CONSENT_REQUEST_TTL_SECONDS = 15 * 60

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
  /** Only meaningful for `kind: 'refresh'` — see `rotateTokens`. */
  previousTokenHash?: string,
): Promise<void> => {
  await OAuthTokenModel.create({
    tokenHash: hashToken(raw),
    kind,
    clientId: grant.clientId,
    userId: new Types.ObjectId(grant.userId),
    scopes: grant.scopes,
    resource: grant.resource,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    ...(previousTokenHash ? { previousTokenHash } : {}),
  })
}

/**
 * Issues a fresh access/refresh pair for one assistant acting for one user.
 *
 * `previousRefreshTokenHash`, when given, is recorded on the new refresh
 * token so a later presentation of the one it replaced can be recognised as a
 * reuse rather than an ordinary unknown token (see `rotateTokens`).
 */
export const issueTokens = async (
  grant: {
    clientId: string
    userId: string
    scopes: string[]
    resource?: string
  },
  previousRefreshTokenHash?: string,
): Promise<IssuedTokens> => {
  const accessToken = generateToken()
  const refreshToken = generateToken()
  await Promise.all([
    store('access', accessToken, grant, ACCESS_TOKEN_TTL_SECONDS),
    store(
      'refresh',
      refreshToken,
      grant,
      REFRESH_TOKEN_TTL_SECONDS,
      previousRefreshTokenHash,
    ),
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
  if (!doc) {
    // Not a live token — could be unknown, expired, or one this pair already
    // rotated past. Only the last of those is evidence of anything, so look
    // for it before answering (finding 3,
    // docs/plans/OAUTH_CONSENT_SECURITY.md): a stolen token is worth one
    // exchange to the thief too, and the race is who presents it first. If
    // this is the loser of that race presenting the token again, the winner's
    // replacement is sitting right there with `previousTokenHash` pointing
    // back at it.
    await detectRotatedReplay(raw, clientId)
    return null
  }

  // A client may ask for less than it holds, never for more: anything outside
  // the original grant is dropped rather than treated as an error, which is
  // what RFC 6749 §6 requires.
  const scopes = narrowedScopes?.length
    ? narrowedScopes.filter(scope => doc.scopes.includes(scope))
    : doc.scopes

  return issueTokens(
    {
      clientId: doc.clientId,
      userId: doc.userId.toString(),
      scopes,
      resource: doc.resource,
    },
    hashToken(raw),
  )
}

/**
 * Checks whether a presented refresh token is one this (client, user) pair
 * already rotated away from, and if so ends the connection outright.
 *
 * A merely unknown or expired token proves nothing and is left alone — the
 * lookup below only matches a token that names it as `previousTokenHash`,
 * which only a real rotation can have written. `disconnect` covers every
 * token the pair currently holds, not only the one descended from this one,
 * because a theft anywhere in the chain means the whole connection is
 * compromised, not one branch of it.
 */
const detectRotatedReplay = async (
  raw: string,
  clientId: string,
): Promise<void> => {
  const successor = await OAuthTokenModel.findOne({
    kind: 'refresh',
    clientId,
    previousTokenHash: hashToken(raw),
  })
  if (!successor) return

  const userId = successor.userId.toString()
  await disconnect(userId, clientId)
  await notifyConnectionRevoked(userId, clientId)
}

/**
 * Tells the user their assistant connection was cut, because this is the
 * only case where a disconnect they did not ask for is the sole visible
 * trace of a token theft attempt. Best-effort and silent on failure, exactly
 * like the other account mail in auth/emails.ts — losing this notice is
 * regrettable, but must never turn a security response into a 500.
 */
const notifyConnectionRevoked = async (
  userId: string,
  clientId: string,
): Promise<void> => {
  if (!mailerAvailable()) return
  try {
    const [user, client] = await Promise.all([
      UserModel.findById(userId),
      OAuthClientModel.findOne({ clientId }),
    ])
    if (!user) return
    const name = client?.clientName ?? 'An assistant'
    await sendMail({
      to: user.email,
      subject: 'An assistant connection was disconnected',
      text: [
        `Hi ${user.displayName},`,
        '',
        `"${name}" was disconnected from your Slide Machine account just now.`,
        'This was not something you asked for: a connection is only cut this',
        'way when a security token for it was used twice, which can mean it',
        'leaked.',
        '',
        'If you still want to use this assistant, reconnect it from your',
        'account settings — it will need to ask for permission again.',
      ].join('\n'),
    })
  } catch (error) {
    console.warn('Could not send the connection-revoked email:', error)
  }
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
