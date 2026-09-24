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
  revokeToken,
  rotateTokens,
  verifyToken,
} from './store'
import { OAuthTokenModel } from '../models/oauth-token'
import { ALL_SCOPES, isScope, SCOPES } from './scopes'
import { env } from '../config/env'

/** Where the browser is sent to ask the user (a route in the SPA). */
export const CONSENT_PATH = '/oauth/consent'

/**
 * The cookie that proves the browser reading, approving or denying a parked
 * request is the one that started it (finding 1a,
 * docs/plans/OAUTH_CONSENT_SECURITY.md). Carries `<requestId>.<nonce>`; only
 * the nonce's HMAC is ever written down, so the cookie itself is what proves
 * possession — matching every other secret in this subsystem.
 *
 * Necessary but not sufficient: it stops an attacker who parked a request and
 * handed the *link* to someone else, but not the harder variant where the
 * victim's own browser makes the authorize request (the binding then passes
 * honestly, because it is genuinely the same browser). That variant is what
 * `GET /oauth/authorization/:id` returning the account and redirect host
 * (routes/oauth.ts) exists to catch instead.
 */
export const CONSENT_COOKIE = 'sm_oauth_consent'

/**
 * Scoped to `/api/oauth` — where the three person-facing consent endpoints
 * actually answer (routes/oauth.ts) — rather than `/oauth`, which is the
 * machine-facing SDK router mounted at the application root and never reads
 * this cookie. A path of `/` would ride along on every request to the
 * origin, including ones a request logger or APM might capture.
 *
 * SameSite=Lax rather than Strict: the one legitimate cross-site moment in
 * this flow is the assistant's own redirect landing the user on
 * `/oauth/authorize`, a top-level navigation Lax still allows. It still keeps
 * the cookie off cross-site fetch/XHR, which is the exposure that matters.
 */
const consentCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/api/oauth',
} as const

/** Sets the binding cookie for a freshly parked request. */
const setConsentCookie = (
  res: Response,
  requestId: string,
  nonce: string,
): void => {
  res.cookie(CONSENT_COOKIE, `${requestId}.${nonce}`, {
    ...consentCookieOptions,
    maxAge: CONSENT_REQUEST_TTL_SECONDS * 1000,
  })
}

/**
 * Clears it once the flow has an answer. `clearCookie` needs the same
 * options (minus `maxAge`) or the browser keeps the cookie — the same Express
 * gotcha routes/auth.ts already works around for the refresh cookie.
 */
export const clearConsentCookie = (res: Response): void => {
  res.clearCookie(CONSENT_COOKIE, consentCookieOptions)
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
 * If `codeHash` names a grant that was already redeemed, revokes exactly the
 * tokens that redemption produced (finding 2,
 * docs/plans/OAUTH_CONSENT_SECURITY.md).
 *
 * Called whenever an exchange fails, which covers far more than genuine
 * replays — an unknown code, an expired one, and a wrong redirect URI all end
 * up here too. Those are told apart by this query alone: `redeemedAt` only
 * exists on a row that a *successful* exchange already consumed, so a code
 * that is merely wrong or not-yet-usable finds nothing and nothing happens.
 * A code presented a second time after it worked once is the one case that
 * matches, and that is a leak regardless of which caller is holding it now.
 */
const revokeReplayedGrant = async (
  codeHash: string,
  clientId: string,
): Promise<void> => {
  const spent = await OAuthAuthorizationModel.findOne({
    codeHash,
    clientId,
    redeemedAt: { $exists: true },
  })
  if (!spent) return
  await Promise.all(
    [spent.issuedAccessTokenHash, spent.issuedRefreshTokenHash]
      .filter((hash): hash is string => Boolean(hash))
      .map(tokenHash => OAuthTokenModel.deleteOne({ tokenHash })),
  )
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
      await revokeReplayedGrant(codeHash, client.client_id)
      throw new InvalidGrantError('Authorization code is not valid')
    }

    const tokens = await issueTokens({
      clientId: client.client_id,
      userId: grant.userId.toString(),
      // The scopes the user approved, not the ones asked for now.
      scopes: grant.scopes,
      resource: grant.resource,
    })

    // finding 2: record what this exchange produced, so a replay of this same
    // code can revoke exactly these tokens rather than only being refused.
    await OAuthAuthorizationModel.updateOne(
      { _id: grant._id },
      {
        $set: {
          issuedAccessTokenHash: hashToken(tokens.accessToken),
          issuedRefreshTokenHash: hashToken(tokens.refreshToken),
        },
      },
    )

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
