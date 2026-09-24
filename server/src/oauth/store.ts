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
): Promise<void> => {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await OAuthTokenModel.create({
    tokenHash: hashToken(raw),
    kind,
    clientId: grant.clientId,
    userId: new Types.ObjectId(grant.userId),
    scopes: grant.scopes,
    resource: grant.resource,
    expiresAt,
    // Starts equal to `expiresAt` — a fresh token is spendable for its whole
    // life until something supersedes it. Only ever read on `kind: 'refresh'`
    // rows; harmless and unused on `kind: 'access'` ones.
    usableUntil: expiresAt,
  })
}

/**
 * Issues a fresh access/refresh pair for one assistant acting for one user.
 *
 * Used to also take a `familyId`, grouping this pair with everything
 * descended from the same authorization grant so a leak could be revoked as
 * a chain rather than by `(userId, clientId)` alone. Dropped along with the
 * rest of the token-family machinery — see `revokeConnection` below and
 * docs/DECISIONS.md's "Findings 2/3 rescope" entry for why: three
 * consecutive reviews of that machinery each found a fresh defect in it, and
 * the plan doc's own recommendation for both findings was the blunter
 * `disconnect(userId, clientId)` this file already had.
 */
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
 * Rotation with a grace window, not immediate deletion (root cause B,
 * rework round 1). The presented row is **not** removed on a successful
 * rotation — its `usableUntil` is shortened to a grace window and
 * `supersededAt` is stamped, mirroring what `auth/refresh-store.ts` already
 * does for this application's own sign-in sessions, including the one-way
 * ratchet (`usableUntil` is only ever shortened, never re-extended) that
 * stops a repeatedly replayed token from renewing its own life. `expiresAt`
 * (retention) is never touched here — see the model's own note on
 * `usableUntil` for why (root cause 3, rework round 2). The MCP SDK client
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
    // No `expiresAt` filter here on purpose: a superseded row past its
    // spendable window is exactly what distinguishes reuse from an ordinary
    // retry, and that distinction needs the row to still be findable —
    // which it now is, for as long as `expiresAt` (untouched retention, not
    // the grace window; see `usableUntil` on the model) keeps it around.
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
  // Falls back to `expiresAt` for a row written before `usableUntil`
  // existed (rework round 2's must-fix 1) — for a token nobody has rotated
  // yet, the two mean the same thing anyway.
  const usableUntil = doc.usableUntil ?? doc.expiresAt
  if (usableUntil <= now) {
    if (doc.supersededAt) {
      // Presented after its own window closed: either a stolen token
      // replayed once the honest side already moved on, or an honest client
      // retrying so late that the distinction stopped mattering. Either way
      // a live refresh token has no legitimate reason to be presented again
      // this late, so the whole connection ends — every token this
      // (user, client) pair holds, not only the ones descended from this one
      // grant (see `revokeConnection`'s own docstring for why that narrower
      // scoping was dropped). No retry: this row was already read above, so
      // what needs deleting is known to exist and is not mid-write.
      try {
        await revokeConnection(doc.userId.toString(), clientId)
      } catch (error) {
        console.warn('Could not end a compromised OAuth connection:', error)
      }
    }
    // A plain expiry that was never rotated (idle far past its TTL) is
    // ordinary, ignored, and refused exactly like any other unknown token.
    return null
  }

  if (!doc.supersededAt) {
    // Stamped unconditionally, on first rotation, regardless of whether
    // `usableUntil` below actually moves (rework round 2's must-fix 2) —
    // this is the fact "has this token ever been rotated", and a token
    // rotated within its own last moments still needs to carry it, or a
    // replay of it later is indistinguishable from a plain unknown token.
    doc.supersededAt = now
    const graceEnd = new Date(now.getTime() + env.REFRESH_GRACE_SECONDS * 1000)
    // Only ever shortens, and only once per token — a second presentation
    // inside the window below re-enters this branch with `supersededAt`
    // already set and skips straight to issuing another fresh pair, rather
    // than sliding the window forward and letting a replayed token renew
    // its own life indefinitely. `expiresAt` (retention) is never touched
    // here — see `usableUntil` on the model for why (must-fix 3).
    if (usableUntil > graceEnd) doc.usableUntil = graceEnd
    try {
      await doc.save()
    } catch (error) {
      console.warn('Could not record refresh-token rotation:', error)
      return null
    }
  }

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

/**
 * Outstanding fire-and-forget work from `revokeConnection`'s notify email, so
 * a test can wait for it deterministically instead of a fixed pause (rework
 * round 2: the previous fix for the flake this caused was a sleep in
 * `beforeEach`, which is exactly the kind of timing-dependent guess this
 * project's own testing guidance says to avoid — it happened to be long
 * enough here, and would not reliably stay that way on a slower or more
 * loaded machine).
 *
 * Production code never reads this set or awaits `drainPendingSideEffects`
 * — the notify email tracked here stays genuinely fire-and-forget for its
 * caller, which is what root cause F2 (the mail-relay timing oracle) requires.
 * Tracking it costs one `Set` insert and a `.catch`/`.finally` per call, paid
 * only by the revocation path, and is otherwise inert.
 */
const pendingSideEffects = new Set<Promise<unknown>>()

/**
 * Fires `promise` without making the caller wait for it, while still letting
 * a test await it deterministically via `drainPendingSideEffects`.
 *
 * The `.catch` is load-bearing, not decoration (docs/DECISIONS.md's
 * "Findings 2/3 rescope" entry, its own finding 2): `.finally` returns a
 * *new* promise that rejects whenever the original does, and the old
 * `void promise.finally(...)` attached no handler to that new promise — an
 * unhandled rejection, which Node terminates the process on by default.
 * Every side effect tracked here already catches its own errors internally
 * (`notifyConnectionRevoked`, `revokeConnection`), so this is a backstop
 * against a future caller that does not, not evidence one currently needs it.
 */
export const trackSideEffect = (promise: Promise<unknown>): void => {
  pendingSideEffects.add(promise)
  void promise.catch(() => {}).finally(() => pendingSideEffects.delete(promise))
}

/** Test-only: resolves once every fire-and-forget call tracked above and
 * still in flight at the time it is called has settled. */
export const drainPendingSideEffects = async (): Promise<void> => {
  await Promise.allSettled([...pendingSideEffects])
}

/**
 * Ends a connection outright: every access and refresh token one assistant
 * holds for one user — the same operation the connected-assistants list's own
 * "Disconnect" button performs (`disconnect`, below), reused here as the
 * automatic response to detected refresh-token reuse (finding 3,
 * docs/plans/OAUTH_CONSENT_SECURITY.md — the only caller now; see below on
 * finding 2).
 *
 * This replaces an earlier, tighter design — a per-grant "token family" that
 * could be revoked as the one compromised chain without ever touching a
 * second, unrelated connection the same assistant held for the same account.
 * Three consecutive reviews of that machinery each found a fresh defect in
 * it (a required field with no migration path, a stamp gated on the wrong
 * condition, a retry loop that could stop half-finished, a timing oracle, a
 * legacy row that was never actually upgraded — see docs/DECISIONS.md's
 * "Findings 2/3 rescope" entry). The plan doc's own original recommendation
 * for both findings was this blunter operation; that is what this is.
 *
 * **The accepted trade:** a user who holds two separate connections to the
 * same assistant (the same `client_id`, e.g. two devices each having gone
 * through consent independently) loses both when either one's token is
 * reused — a reviewer demonstrated this concretely against the family
 * design's replacement. That is worse than the family design's blast radius,
 * and better than production today, which had no automatic teardown for
 * either finding at all. Judged acceptable at MEDIUM severity given the
 * defect rate the tighter alternative was producing.
 *
 * **Finding 2 no longer calls this at all** (docs/DECISIONS.md, "Finding 2's
 * revocation-on-replay was tried and removed"): a replayed authorization code
 * is refused, full stop, with no automatic teardown. That removed the one
 * caller that needed a retry (the concurrent-double-exchange race a
 * fire-and-forget delete had to wait out) — the refresh-reuse path below
 * never needed one, since it always reads the row it is revoking before
 * calling this, so the tokens it is asking to delete are already known to
 * exist and are not mid-write. No `retry` parameter remains as a result;
 * this is a plain, single-attempt delete.
 */
export const revokeConnection = async (
  userId: string,
  clientId: string,
): Promise<void> => {
  const deletedCount = await disconnect(userId, clientId)

  if (deletedCount === 0) {
    // Nothing was actually revoked (must-fix 5, rework round 2) — most often
    // a redeemed authorization-code row (5-minute life) presented a second
    // time after the connection was already gone for an unrelated reason.
    // Notifying here would be a false "your assistant may have leaked"
    // email about a connection nothing touched.
    return
  }

  // Best-effort from here, and deliberately not awaited by the caller: a
  // teardown must not make the refusal that triggered it any slower, and a
  // configured SMTP relay is a real network round trip (lib/mailer.ts's own
  // timeouts run to twenty seconds) that would otherwise make a genuine
  // replay's refusal measurably slower than an unknown token's — a timing
  // oracle for "this token was once real" (root cause F2). Tracked rather
  // than fully detached so tests can await it deterministically
  // (`drainPendingSideEffects`) instead of guessing at a sleep duration.
  trackSideEffect(notifyConnectionRevoked(userId, clientId))
  logConnectionRevoked(userId, clientId, deletedCount)
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
  tokensRevoked: number,
): void => {
  console.error(
    `[oauth] connection revoked: userId=${userId} clientId=${clientId} ` +
      `tokensRevoked=${tokensRevoked}`,
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

/**
 * The assistants currently holding a live token for this account.
 *
 * Filtered on `usableUntil` as well as `expiresAt` (finding 1,
 * docs/plans/OAUTH_CONSENT_SECURITY.md, and a regression this branch
 * introduced): rotation now keeps a superseded refresh row around at its
 * full original `expiresAt` — up to 182 days — as evidence for reuse
 * detection (see the model's own note on `usableUntil`), so filtering on
 * `expiresAt` alone listed an assistant as connected for months after it was
 * disconnected or individually revoked. `usableUntil` is the field that
 * actually answers "can this row still be spent right now", and — per the
 * `store` helper above — every row this server writes carries one, set equal
 * to `expiresAt` at creation and only ever shortened by rotation. Requiring
 * *both* rather than switching to `usableUntil` alone matters for the same
 * reason `verifyToken` checks `expiresAt` explicitly instead of trusting the
 * TTL sweep to have run: retention lapsing is itself reason enough to drop a
 * row, independent of whatever `usableUntil` says. A row with no
 * `usableUntil` at all (written before that field existed) falls back to
 * `expiresAt` alone for spendability too.
 */
export const connectionsFor = async (
  userId: string,
): Promise<{ clientId: string; scopes: string[]; connectedAt: Date }[]> => {
  const now = new Date()
  const docs = await OAuthTokenModel.find({
    userId: new Types.ObjectId(userId),
    // Retention must not have lapsed (`expiresAt`, checked in the query
    // rather than left to the TTL sweep for the same reason `verifyToken`
    // does — the reaper runs on a delay, and an expired row can still be
    // found in between), *and*, when the row tracks spendability
    // separately, that must not have lapsed either — `usableUntil` is what
    // catches a superseded refresh row still sitting inside its long
    // retention window. A row with no `usableUntil` at all (written before
    // that field existed) has only `expiresAt` to go on.
    expiresAt: { $gt: now },
    $or: [{ usableUntil: { $gt: now } }, { usableUntil: { $exists: false } }],
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
