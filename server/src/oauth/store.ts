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
  familyId: string,
): Promise<void> => {
  await OAuthTokenModel.create({
    tokenHash: hashToken(raw),
    kind,
    clientId: grant.clientId,
    userId: new Types.ObjectId(grant.userId),
    scopes: grant.scopes,
    resource: grant.resource,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    familyId,
  })
}

/**
 * Issues a fresh access/refresh pair for one assistant acting for one user.
 *
 * `familyId` groups this pair with everything descended from the same
 * authorization grant (rework round 1's root cause A) — the authorization
 * code's own `codeHash` for a grant's first pair, or the presented refresh
 * token's own `familyId` when this is a rotation. Required, not optional:
 * every token this server issues must be revocable as a family, or the
 * revocation added for finding 2/3 quietly stops covering it.
 */
export const issueTokens = async (
  grant: {
    clientId: string
    userId: string
    scopes: string[]
    resource?: string
  },
  familyId: string,
): Promise<IssuedTokens> => {
  const accessToken = generateToken()
  const refreshToken = generateToken()
  await Promise.all([
    store('access', accessToken, grant, ACCESS_TOKEN_TTL_SECONDS, familyId),
    store('refresh', refreshToken, grant, REFRESH_TOKEN_TTL_SECONDS, familyId),
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
 * Rotation with a grace window, not immediate deletion (root cause B,
 * rework round 1). The presented row is **not** removed on a successful
 * rotation — its `expiresAt` is shortened to a grace window and
 * `supersededAt` is stamped, mirroring what `auth/refresh-store.ts` already
 * does for this application's own sign-in sessions, including the one-way
 * ratchet (`expiresAt` is only ever shortened, never re-extended) that stops
 * a repeatedly replayed token from renewing its own life. The MCP SDK client
 * has no single-flight around refresh (four independent call sites, no
 * mutex), so a lost response's retry presents the *same* token the client
 * has always had — punishing that with a full teardown was rework round 1's
 * finding B1, reproduced with a 100% deterministic repro (no timing needed).
 *
 * `clientId` is checked throughout — a refresh token is bound to the
 * assistant it was issued to, and one client must not be able to redeem
 * another's.
 */
export const rotateTokens = async (
  raw: string,
  clientId: string,
  narrowedScopes?: string[],
): Promise<IssuedTokens | null> => {
  const tokenHash = hashToken(raw)
  let doc
  try {
    // No `expiresAt` filter here on purpose: a superseded row past its grace
    // window is exactly what distinguishes reuse from an ordinary retry, and
    // that distinction needs the row even after its shortened expiry has
    // passed (it is still findable until the TTL reaper removes it, per this
    // file's existing note on `verifyToken` about that ~1-minute cadence).
    doc = await OAuthTokenModel.findOne({
      tokenHash,
      kind: 'refresh',
      clientId,
    })
  } catch (error) {
    // A lookup that cannot complete must still look like "this token does
    // not work" rather than surface as a 500 (root cause F1) — the SDK maps
    // anything that is not an OAuthError that way, which would make a
    // transient database hiccup a *more* informative answer than an
    // ordinary unknown token, breaking the uniform-refusal property.
    console.warn('Refresh token lookup failed:', error)
    return null
  }
  if (!doc) return null

  const now = new Date()
  if (doc.expiresAt <= now) {
    if (doc.supersededAt) {
      // Presented after its own grace window closed: either a stolen token
      // replayed once the honest side already moved on, or an honest client
      // retrying so late that the distinction stopped mattering. Either way
      // a live refresh token has no legitimate reason to be presented again
      // this late, so the whole family ends.
      try {
        await endFamily(doc.familyId, doc.userId.toString(), clientId)
      } catch (error) {
        console.warn('Could not end a compromised OAuth connection:', error)
      }
    }
    // A plain expiry that was never rotated (idle far past its TTL) is
    // ordinary, ignored, and refused exactly like any other unknown token.
    return null
  }

  if (!doc.supersededAt) {
    const graceEnd = new Date(now.getTime() + env.REFRESH_GRACE_SECONDS * 1000)
    // Only ever shortens, and only once per token — a second presentation
    // inside the window below re-enters this branch with `supersededAt`
    // already set and skips straight to issuing another fresh pair, rather
    // than sliding the window forward and letting a replayed token renew
    // its own life indefinitely.
    if (doc.expiresAt > graceEnd) {
      doc.expiresAt = graceEnd
      doc.supersededAt = now
      try {
        await doc.save()
      } catch (error) {
        console.warn('Could not record refresh-token rotation:', error)
        return null
      }
    }
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
    doc.familyId,
  )
}

/** A short, bounded pause — used only to close the narrow window where a
 * genuinely concurrent double-exchange's loser checks for a family to
 * revoke before the winner has finished writing it (see `endFamily`). */
const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * Ends a whole token family: every access and refresh token descended from
 * one authorization grant, however many times it has rotated since (root
 * cause A, rework round 1). Tighter than `disconnect(userId, clientId)` —
 * which is kept for the user's own explicit "Disconnect" button — because a
 * family only ever covers the one compromised chain, never a second live
 * connection the same assistant happens to hold for the same account.
 *
 * `retry`, when given, re-attempts the delete a bounded number of times with
 * a short pause between attempts. Used only by the authorization-code replay
 * path (`revokeFamilyIfRedeemed` in provider.ts), where a genuinely
 * concurrent double exchange can have its loser reach here before the
 * winner's `issueTokens` has finished writing the very tokens that need
 * revoking — a real gap the reviewers measured as "4/4 concurrent
 * double-exchanges revoked nothing" before this existed. The refresh-reuse
 * path (`rotateTokens` above) never needs it: it always reads the row it is
 * revoking before calling this, so the tokens it is asking to delete are
 * already known to exist.
 */
export const endFamily = async (
  familyId: string,
  userId: string,
  clientId: string,
  retry?: { attempts: number; delayMs: number },
): Promise<void> => {
  const attempts = retry?.attempts ?? 1
  let deletedCount = 0
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await OAuthTokenModel.deleteMany({ familyId })
    deletedCount += result.deletedCount ?? 0
    if (result.deletedCount) break
    if (retry && attempt < attempts - 1) await sleep(retry.delayMs)
  }

  // Best-effort from here, and deliberately not awaited by the caller: a
  // teardown must not make the refusal that triggered it any slower, and a
  // configured SMTP relay is a real network round trip (lib/mailer.ts's own
  // timeouts run to twenty seconds) that would otherwise make a genuine
  // replay's refusal measurably slower than an unknown token's — a timing
  // oracle for "this token was once real" (root cause F2).
  void notifyConnectionRevoked(userId, clientId)
  void logConnectionRevoked(userId, clientId, familyId, deletedCount)
}

/**
 * Tells the user their assistant connection was cut, because this is the
 * only case where a disconnect they did not ask for is the sole visible
 * trace of a token theft attempt. Best-effort and silent on failure, exactly
 * like the other account mail in auth/emails.ts — losing this notice is
 * regrettable, but must never turn a security response into a 500 (and,
 * since it is fired without being awaited, never turn it into a delay).
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

/**
 * A trace of the teardown that does not depend on mail being configured
 * (root cause F3): `MAIL_PROVIDER=none` is a documented deployment value,
 * and the default `smtp` provider with no `SMTP_HOST` behaves the same way
 * — `notifyConnectionRevoked` above returns before doing anything, and
 * without this there would be no record anywhere that a connection was cut.
 * `console.error` rather than one of this repo's audit-log tables
 * (audit/log.ts, audit/agent-log.ts, audit/settings-log.ts): each of those
 * is shaped for a different actor (an admin, an MCP tool call, a settings
 * edit) and none fits "the token endpoint ended a connection on its own
 * initiative" without bending its schema: see docs/DECISIONS.md.
 */
const logConnectionRevoked = (
  userId: string,
  clientId: string,
  familyId: string,
  tokensRevoked: number,
): void => {
  console.error(
    `[oauth] connection revoked: userId=${userId} clientId=${clientId} ` +
      `familyId=${familyId} tokensRevoked=${tokensRevoked}`,
  )
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
