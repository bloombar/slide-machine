/**
 * The authorization server itself (docs/MCP.md §5).
 *
 * The MCP SDK owns the endpoints — `/authorize`, `/token`, `/register`,
 * `/revoke` and the two metadata documents — and calls into this object for
 * every decision that is actually ours. That split is deliberate: the OAuth
 * and MCP authorization specs are young and still moving (docs/MCP.md §5.4),
 * and protocol plumbing is code this project would otherwise have to track
 * them with forever. What is written here is only the policy.
 *
 * ## The role reversal
 *
 * Slide Machine already speaks OAuth — to Google, for sign-in and Drive. It
 * has always been the side *asking*. Here it is the side *granting*: it shows
 * the consent screen, it issues the tokens, it honours and withdraws them.
 * That is a different job with different failure modes, and the important one
 * is that bugs in this file are account-takeover bugs rather than feature
 * bugs. Two rules follow, and neither is negotiable:
 *
 *   - **Nothing here trusts a parameter it did not store.** The redirect URI
 *     is checked against the client's registration when the request is made
 *     and compared again when the code is exchanged. The scopes are the ones
 *     written down at consent, never the ones asked for at exchange.
 *   - **A refusal says as little as possible.** An invalid code, an expired
 *     one, one belonging to another client and one already spent are the same
 *     answer, because the differences are only useful to someone guessing.
 *
 * ## Where the user comes in
 *
 * `authorize` does not decide anything. It writes down what the assistant
 * asked for and sends the browser to the consent screen; approval happens in
 * routes/oauth.ts, against a signed-in session. This file never sees a
 * password and never authenticates anyone — it only records who said yes.
 */
import { randomUUID } from 'node:crypto'
import type { Response } from 'express'
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  InvalidGrantError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { OAuthClientModel } from '../models/oauth-client'
import { OAuthAuthorizationModel } from '../models/oauth-authorization'
import {
  CONSENT_REQUEST_TTL_SECONDS,
  generateToken,
  hashToken,
  issueTokens,
  revokeConnection,
  revokeToken,
  rotateTokens,
  trackSideEffect,
  verifyToken,
} from './store'
import { ALL_SCOPES, isScope, SCOPES } from './scopes'

/** Where the browser is sent to ask the user (a route in the SPA). */
export const CONSENT_PATH = '/oauth/consent'

/**
 * The name of the cookie that proves the browser reading, approving or
 * denying a parked request is the one that started it (finding 1a,
 * docs/plans/OAUTH_CONSENT_SECURITY.md). Carries the raw nonce; only its
 * HMAC is ever written down, matching every other secret in this subsystem —
 * "signed" in earlier drafts of this fix overstated it, since nothing here
 * uses `cookie-parser`'s signing (`app.ts` never gives it a secret).
 *
 * **Named per request** rather than one fixed name for every flow (root
 * cause C4, rework round 1): a single shared cookie name meant a *second*
 * `GET /oauth/authorize` — a second assistant connected, a double-clicked
 * Connect button, a client whose own retry logic redirects here twice —
 * silently overwrote the first flow's cookie. The first flow's request then
 * looked "not mine" to its own browser and refused identically to the
 * attack case it cannot be told apart from, with no way to recover except
 * starting over. Naming the cookie after the request id it belongs to means
 * two concurrently parked flows simply hold two different cookies.
 *
 * **Bounded to a fixed number of slots** (finding 5,
 * docs/plans/OAUTH_CONSENT_SECURITY.md), rather than one truly unique name
 * per request: `GET /oauth/authorize` is unauthenticated, and only the one
 * flow that gets *answered* ever clears its own cookie (`clearConsentCookie`)
 * — an abandoned or repeatedly retried flow just leaves its cookie sitting
 * there for the full 15-minute window. Unbounded, that is a cookie per hit,
 * which at the browser's per-domain cap starts evicting cookies this origin
 * actually needs (`sm_refresh`, notably), and a large enough `Cookie` header
 * can exceed Node's default 16KB `maxHeaderSize`. This handler has no `req`
 * to inspect what a given browser already holds — the SDK's `authorize` only
 * passes `res` — so the fix is to bound the *name space* instead of tracking
 * occupancy: every request id hashes onto one of `CONSENT_COOKIE_SLOTS`
 * cookie names, so however many `GET /oauth/authorize` hits a browser
 * accumulates, it never holds more than that many of these cookies.
 *
 * The accepted cost is collision: two flows parked close together whose
 * request ids happen to land on the same slot share one cookie, and the
 * later one silently overwrites the earlier's. That reproduces root cause
 * C4's original symptom (the earlier flow now looks "not mine" to its own
 * browser and gets the ordinary uniform refusal) for whichever unlucky pair
 * collides, rather than eliminating it outright — a real trade, not a free
 * fix. With enough slots relative to how many flows one browser realistically
 * parks at once (rarely more than one or two — a second tab, a double-clicked
 * Connect button), a collision is uncommon, and unlike the unbounded scheme
 * this replaces, the cookie *count* now has a hard ceiling regardless of how
 * many requests are made.
 */
const CONSENT_COOKIE_SLOTS = 64

/** A slot number for `requestId`, stable across calls and not required to be
 * cryptographically strong — the slot itself carries no secret, only the
 * count of distinct cookie names needs bounding. Works for any string,
 * including a malformed or attacker-supplied `:id` route param, so a bad
 * input degrades to "some slot" rather than throwing. */
const consentCookieSlot = (requestId: string): number => {
  let hash = 0
  for (let i = 0; i < requestId.length; i++) {
    hash = (hash * 31 + requestId.charCodeAt(i)) >>> 0
  }
  return hash % CONSENT_COOKIE_SLOTS
}

export const consentCookieName = (requestId: string): string =>
  `__Host-sm_oauth_consent_${consentCookieSlot(requestId)}`

/**
 * Cookie attributes for the binding cookie (finding 1a / root cause C1,
 * rework round 1).
 *
 * **`__Host-` prefixed, which is not decoration.** Both reviewers
 * demonstrated that an `httpOnly`/`SameSite=Lax` cookie alone can still be
 * *planted*: an attacker parks their own flow via the unauthenticated
 * `GET /oauth/authorize`, receives a validly-issued (if this file ever
 * claimed "signed", validly-*signed*) cookie, and hands the victim that
 * cookie's value to set for themselves — cookies are not origin-isolated by
 * default, so any same-site actor (a subdomain, a staging host, a plain-http
 * MITM) can write one for this origin. `__Host-` closes exactly that: the
 * browser refuses to honour the prefix at all unless the cookie also carries
 * `Secure`, no `Domain` attribute, and `Path=/`, which together mean **only
 * a response from this exact origin can ever set it**. A victim's browser
 * can then only ever hold a value this application itself handed it, for a
 * flow their own browser actually requested — which is precisely the
 * harder variant `GET /oauth/authorization/:id` returning the account and
 * redirect target (routes/oauth.ts) exists to catch, not a new hole.
 *
 * `Path=/` is mandatory for the prefix, so this **no longer avoids riding on
 * every request to the origin** the way scoping to `/api/oauth` did in
 * round 1 — a real cost (a request logger or APM now sees it everywhere),
 * accepted because a narrower path that can be planted is not a mitigation
 * at all, and a `__Host-` cookie that cannot be planted is.
 *
 * `secure: true` unconditionally, not only in production: the prefix
 * requires it, and browsers treat `localhost`/`127.0.0.1` as a secure
 * context even over plain http, which is the only place `isUsableIssuer`
 * (routes/oauth.ts) ever lets this feature run non-https anyway.
 */
const consentCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: true,
  path: '/',
} as const

/** Sets the binding cookie for a freshly parked request. */
const setConsentCookie = (
  res: Response,
  requestId: string,
  nonce: string,
): void => {
  res.cookie(consentCookieName(requestId), nonce, {
    ...consentCookieOptions,
    maxAge: CONSENT_REQUEST_TTL_SECONDS * 1000,
  })
}

/**
 * Clears it once the flow has an answer. `clearCookie` needs the same
 * options (minus `maxAge`) or the browser keeps the cookie — the same Express
 * gotcha routes/auth.ts already works around for the refresh cookie.
 */
export const clearConsentCookie = (res: Response, requestId: string): void => {
  res.clearCookie(consentCookieName(requestId), consentCookieOptions)
}

/**
 * Clients register themselves (RFC 7591) and are stored as they registered.
 *
 * Registration is open, which is the point — an assistant nobody arranged in
 * advance can introduce itself, and without that "use whichever assistant you
 * prefer" is not true. It is also why registration confers nothing: an
 * unknown client that has registered can reach no lecture until a user has
 * stood in front of a consent screen and said yes.
 */
export const clientsStore: OAuthRegisteredClientsStore = {
  getClient: async (clientId: string) => {
    const doc = await OAuthClientModel.findOne({ clientId })
    if (!doc) return undefined
    return doc.metadata as unknown as OAuthClientInformationFull
  },

  registerClient: async client => {
    const clientId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // A client that cannot keep a secret says so by asking for `none`; giving
    // it one anyway would be a secret shipped to every user's laptop. Those
    // clients are identified by PKCE, which is why OAuth 2.1 requires it.
    const isPublic = client.token_endpoint_auth_method === 'none'
    const secret = isPublic ? undefined : generateToken()

    const full = {
      ...client,
      client_id: clientId,
      client_id_issued_at: now,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    } as OAuthClientInformationFull

    await OAuthClientModel.create({
      clientId,
      secretHash: secret ? hashToken(secret) : undefined,
      clientName: client.client_name,
      redirectUris: client.redirect_uris,
      // Stored with the secret in it, because the SDK's token endpoint
      // authenticates the client by comparing against this record. It is the
      // same trade the Google client credentials already make; the collection
      // is server-side and never leaves it.
      metadata: full as unknown as Record<string, unknown>,
    })

    return full
  },
}

/** Keeps only scopes this server actually defines; unknown ones are dropped. */
const requestedScopes = (scopes: string[] | undefined): string[] => {
  const asked = (scopes ?? []).filter(isScope)
  // An assistant that names nothing gets the harmless half. Defaulting to
  // write would make the consent screen's question meaningless.
  return asked.length ? asked : [SCOPES.read]
}

/**
 * If `codeHash` names a grant that was already redeemed, ends the whole
 * connection that redemption produced (finding 2, rather than only the one
 * grant — see `revokeConnection`'s own docstring in store.ts for why the
 * earlier, finer-grained "token family" design was dropped).
 *
 * Called whenever an exchange fails, which covers far more than genuine
 * replays — an unknown code, an expired one, and a wrong redirect URI all end
 * up here too. Those are told apart by this query alone: `redeemedAt` only
 * exists on a row that a *successful* exchange already consumed, so a code
 * that is merely wrong or not-yet-usable finds nothing and nothing happens.
 * A code presented a second time after it worked once is the one case that
 * matches, and that is a leak regardless of which caller is holding it now.
 *
 * **Not awaited by its caller** (finding 6) — see the call site below.
 * `codeHash` is enough to find the spent grant's `userId` even when nothing
 * was ever issued to it yet, closing the round-1 gap where a genuinely
 * concurrent double exchange's loser found nothing to revoke because the
 * winner had not finished writing a hash snapshot yet. The bounded retry
 * below covers the residual case: the loser can still reach this function
 * before the winner's `issueTokens` call (a second, later operation) has
 * finished writing the tokens that need revoking. Being fire-and-forget now,
 * rather than awaited with a sleep-bearing retry on the hot path, is what
 * makes that retry affordable at all — see the call site.
 */
const revokeConnectionIfRedeemed = async (
  codeHash: string,
  clientId: string,
): Promise<void> => {
  const spent = await OAuthAuthorizationModel.findOne({
    codeHash,
    clientId,
    redeemedAt: { $exists: true },
  })
  if (!spent?.userId) return
  await revokeConnection(spent.userId.toString(), clientId, {
    attempts: 5,
    delayMs: 20,
  })
}

export const provider: OAuthServerProvider = {
  clientsStore,

  /**
   * Records the request and sends the user to the consent screen.
   *
   * The parameters travel in the database, not the browser: what comes back
   * from the consent screen is an id, and everything that matters is re-read
   * from the row it names. A redirect URI carried through the browser is a
   * redirect URI an attacker can edit, and a mishandled redirect is how this
   * kind of server hands someone else's account to a stranger.
   */
  authorize: async (
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> => {
    // finding 1a: a nonce this browser alone will hold, so approving or
    // denying the request later can be checked against the browser that
    // began it rather than only against a guessable-enough request id.
    const nonce = generateToken()
    const request = await OAuthAuthorizationModel.create({
      clientId: client.client_id,
      // Already validated against the client's registration by the SDK's
      // authorize handler before it calls us.
      redirectUri: params.redirectUri,
      state: params.state,
      scopes: requestedScopes(params.scopes),
      codeChallenge: params.codeChallenge,
      resource: params.resource?.href,
      browserNonceHash: hashToken(nonce),
      expiresAt: new Date(Date.now() + CONSENT_REQUEST_TTL_SECONDS * 1000),
    })

    setConsentCookie(res, request._id.toString(), nonce)
    res.redirect(`${CONSENT_PATH}?request=${request._id.toString()}`)
  },

  /** The PKCE challenge this code began with, for the SDK to verify against. */
  challengeForAuthorizationCode: async (
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> => {
    const grant = await OAuthAuthorizationModel.findOne({
      codeHash: hashToken(authorizationCode),
      clientId: client.client_id,
      expiresAt: { $gt: new Date() },
    })
    if (!grant) throw new InvalidGrantError('Authorization code is not valid')
    return grant.codeChallenge
  },

  /**
   * Spends an authorization code.
   *
   * Single use, enforced by the update itself: `redeemedAt` is set in the same
   * atomic operation that reads the row, and a row already carrying one does
   * not match. A replayed code is a stolen session, so this cannot be a
   * read-then-write with a gap in the middle.
   *
   * The redirect URI and resource checks are part of that same atomic filter
   * rather than run afterward (finding 2, docs/plans/OAUTH_CONSENT_SECURITY.md):
   * a version that stamped `redeemedAt` first and validated second let anyone
   * holding a code burn it with a wrong redirect URI — a repeatable denial of
   * connection for the legitimate client, since the row never gets a second
   * chance. PKCE has no such gap: the SDK's token handler calls
   * `challengeForAuthorizationCode` (below) first, which reads the row
   * without writing to it.
   */
  exchangeAuthorizationCode: async (
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> => {
    const codeHash = hashToken(authorizationCode)
    const grant = await OAuthAuthorizationModel.findOneAndUpdate(
      {
        codeHash,
        clientId: client.client_id,
        redeemedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
        // OAuth 2.1 requires the redirect URI to match the one the flow began
        // with, when the request carried one at all.
        ...(redirectUri !== undefined ? { redirectUri } : {}),
        // RFC 8707: a token minted for one resource must not be spendable at
        // another. A grant with no resource on file is unrestricted, so only
        // a genuine mismatch excludes the row.
        ...(resource
          ? {
              $or: [
                { resource: { $exists: false } },
                { resource: resource.href },
              ],
            }
          : {}),
      },
      { $set: { redeemedAt: new Date() } },
    )
    if (!grant?.userId) {
      // Nothing was consumed above — either the code never matched at all, or
      // it did and one of the bindings did not, and either way the row is
      // untouched and can still be exchanged correctly later. What is left to
      // rule out is the other case: a code that really was already spent,
      // which is evidence of a leak regardless of who is asking now.
      //
      // Not awaited (finding 6): awaiting the revocation here — a delete,
      // plus a bounded retry with a sleep between attempts to cover the
      // concurrent-double-exchange race — put 40-100ms on this refusal, but
      // only for a code that really was redeemed before. That gap is
      // measurable, and it re-creates exactly the timing oracle root cause F2
      // already avoids for the notification email a few lines further in.
      // Firing it and throwing immediately closes the gap; `trackSideEffect`
      // (store.ts) is what lets a test still wait for it deterministically.
      trackSideEffect(revokeConnectionIfRedeemed(codeHash, client.client_id))
      throw new InvalidGrantError('Authorization code is not valid')
    }

    const tokens = await issueTokens({
      clientId: client.client_id,
      userId: grant.userId.toString(),
      // The scopes the user approved, not the ones asked for now.
      scopes: grant.scopes,
      resource: grant.resource,
    })

    return {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: grant.scopes.join(' '),
    }
  },

  exchangeRefreshToken: async (
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> => {
    const tokens = await rotateTokens(refreshToken, client.client_id, scopes)
    if (!tokens) throw new InvalidGrantError('Refresh token is not valid')
    return {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
    }
  },

  verifyAccessToken: async (token: string): Promise<AuthInfo> => {
    const verified = await verifyToken(token)
    if (!verified) throw new InvalidTokenError('Token is invalid or expired')
    return {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: Math.floor(verified.expiresAt.getTime() / 1000),
      ...(verified.resource ? { resource: new URL(verified.resource) } : {}),
      // How the MCP route learns whose lectures these are. Everything below
      // that point treats it exactly as it treats a signed-in user id.
      extra: { userId: verified.userId },
    }
  },

  /** RFC 7009. Silent on tokens that were never valid — revocation is not a probe. */
  revokeToken: async (
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> => {
    await revokeToken(request.token)
  },
}

/** The scopes the metadata documents advertise. */
export const supportedScopes = [...ALL_SCOPES]

/** Surfaced so route tests can assert the server refuses rather than throws raw. */
export { ServerError }
