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
  AUTHORIZATION_CODE_TTL_SECONDS,
  generateToken,
  hashToken,
  issueTokens,
  revokeToken,
  rotateTokens,
  verifyToken,
} from './store'
import { ALL_SCOPES, isScope, SCOPES } from './scopes'

/** Where the browser is sent to ask the user (a route in the SPA). */
export const CONSENT_PATH = '/oauth/consent'

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
    const request = await OAuthAuthorizationModel.create({
      clientId: client.client_id,
      // Already validated against the client's registration by the SDK's
      // authorize handler before it calls us.
      redirectUri: params.redirectUri,
      state: params.state,
      scopes: requestedScopes(params.scopes),
      codeChallenge: params.codeChallenge,
      resource: params.resource?.href,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    })

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
   */
  exchangeAuthorizationCode: async (
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> => {
    const grant = await OAuthAuthorizationModel.findOneAndUpdate(
      {
        codeHash: hashToken(authorizationCode),
        clientId: client.client_id,
        redeemedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { redeemedAt: new Date() } },
    )
    if (!grant?.userId) {
      throw new InvalidGrantError('Authorization code is not valid')
    }

    // OAuth 2.1 requires the redirect URI to match the one the flow began
    // with, when the request carried one at all.
    if (redirectUri !== undefined && redirectUri !== grant.redirectUri) {
      throw new InvalidGrantError('Redirect URI does not match the request')
    }
    // RFC 8707: a token minted for one resource must not be spendable at
    // another. Mismatches are refused rather than quietly re-scoped.
    if (resource && grant.resource && resource.href !== grant.resource) {
      throw new InvalidGrantError('Resource does not match the request')
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
