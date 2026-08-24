/**
 * The OAuth endpoints an assistant talks to, and the consent screen's API
 * (docs/MCP.md §5).
 *
 * Two halves, and they are separate on purpose:
 *
 *   - **The machine-facing half** is the SDK's `mcpAuthRouter`, mounted at the
 *     application root because that is where the discovery documents have to
 *     live (RFC 8414 / RFC 9728) — a client finds `/authorize`, `/token`,
 *     `/register` and `/revoke` by reading `/.well-known/...` unaided, which
 *     is what lets an assistant nobody arranged connect at all.
 *   - **The person-facing half** is below: three small endpoints the consent
 *     screen calls. They sit under `/api` with the rest of the application and
 *     require an ordinary signed-in session, because approving a grant is
 *     something a *user* does, not something a client does.
 *
 * The join between them is an id in a URL and nothing else. What the assistant
 * asked for was written down when the flow began (oauth/provider.ts) and is
 * re-read from that row here — never taken from the browser, which is where an
 * attacker would edit it.
 */
import { Router } from 'express'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { OAuthAuthorizationModel } from '../models/oauth-authorization'
import { OAuthClientModel } from '../models/oauth-client'
import { provider, supportedScopes } from '../oauth/provider'
import { generateToken, hashToken } from '../oauth/store'
import { SCOPE_DESCRIPTIONS, type Scope } from '../oauth/scopes'
import { env } from '../config/env'

/**
 * The origin that serves both the SPA and the API — what a client is told the
 * issuer is, and where it will send the user's browser.
 *
 * `CLIENT_APP_URL` first, then `PUBLIC_BASE_URL`, mirroring lib/app-origin.ts:
 * in local development the SPA is on Vite (:5173) and the API on :3000, and an
 * issuer pointing at the API port would send the user to a consent page that
 * does not exist there.
 */
export const issuerOrigin = (): string =>
  env.CLIENT_APP_URL ?? env.PUBLIC_BASE_URL ?? 'http://localhost:3000'

/** Where the MCP endpoint itself lives — the resource a token is minted for. */
export const resourceUrl = (): string => `${issuerOrigin()}/api/mcp`

/**
 * Whether this deployment can be an authorization server at all.
 *
 * RFC 8414 requires an `https` issuer, and the SDK enforces it by throwing
 * when the router is built — with a localhost exemption for development. That
 * throw happens inside `createApp`, so an origin of `http://slides.example.edu`
 * would not disable the MCP endpoint, it would stop the entire application
 * from starting: every lecture, every export, everything, because one optional
 * feature could not be configured.
 *
 * So the condition is checked here instead, and a deployment that cannot host
 * this feature simply does not host it. Losing agent access is a missing
 * feature; failing to boot is an outage.
 */
export const isUsableIssuer = (origin: string): boolean => {
  try {
    const url = new URL(origin)
    return (
      url.protocol === 'https:' ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1'
    )
  } catch {
    // An unparseable origin means the deployment is misconfigured in a way
    // this feature cannot work around either.
    return false
  }
}

export const oauthAvailable = (): boolean => isUsableIssuer(issuerOrigin())

/** The machine-facing half. Mounted at the app root by app.ts. */
export const oauthAuthRouter = (): ReturnType<typeof mcpAuthRouter> =>
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(issuerOrigin()),
    resourceServerUrl: new URL(resourceUrl()),
    resourceName: 'Slide Machine',
    scopesSupported: supportedScopes,
  })

export const oauthConsentRouter = Router()

/**
 * Loads a pending request, refusing anything that is not one.
 *
 * Already-approved requests are refused alongside missing and expired ones:
 * a consent screen reloaded after approval must not be able to mint a second
 * code, and the three cases are indistinguishable to the caller by design.
 */
const pendingRequest = async (id: string) => {
  const request = await OAuthAuthorizationModel.findOne({
    _id: id,
    codeHash: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).catch(() => null)
  if (!request) {
    throw new HttpError(
      404,
      'authorization_not_found',
      'This authorization request has expired or was already answered',
    )
  }
  return request
}

/** Builds the URL the browser is sent back to, carrying the outcome. */
const redirectWith = (
  redirectUri: string,
  state: string | undefined,
  params: Record<string, string>,
): string => {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  // Echoed exactly as sent — it is how the client ties this response to its
  // own request, and dropping it makes a correct client reject the response.
  if (state !== undefined) url.searchParams.set('state', state)
  return url.href
}

/**
 * What the consent screen shows: who is asking, and for what.
 *
 * The client's name is whatever it registered, so it is a label and never a
 * claim — anything may register under any name. That is a real limitation of
 * open registration and the reason the screen names the permissions in the
 * user's own words rather than relying on them recognising the assistant.
 */
oauthConsentRouter.get(
  '/oauth/authorization/:id',
  requireAuth,
  async (req, res) => {
    const request = await pendingRequest(String(req.params.id))
    const client = await OAuthClientModel.findOne({
      clientId: request.clientId,
    })

    res.json({
      clientName: client?.clientName ?? 'An unnamed assistant',
      scopes: request.scopes.map(scope => ({
        scope,
        description:
          SCOPE_DESCRIPTIONS[scope as Scope] ?? 'An unrecognised permission',
      })),
    })
  },
)

/**
 * The user said yes: mint the code and hand back where to send them.
 *
 * The code is stored as an HMAC and the row is stamped with who approved it.
 * Both happen in one update guarded on the request still being pending, so two
 * clicks on a slow connection cannot produce two codes for one consent.
 */
oauthConsentRouter.post(
  '/oauth/authorization/:id/approve',
  requireAuth,
  async (req, res) => {
    const request = await pendingRequest(String(req.params.id))

    const code = generateToken()
    const claimed = await OAuthAuthorizationModel.findOneAndUpdate(
      { _id: request._id, codeHash: { $exists: false } },
      { $set: { codeHash: hashToken(code), userId: req.userId } },
    )
    if (!claimed) {
      throw new HttpError(
        409,
        'already_answered',
        'This authorization request was already answered',
      )
    }

    res.json({
      redirectTo: redirectWith(request.redirectUri, request.state, { code }),
    })
  },
)

/**
 * The user said no.
 *
 * A refusal is still an answer the assistant is owed: OAuth requires the
 * `access_denied` error to travel back to the client, so it can say "you
 * declined" rather than hanging on a request that never returns.
 */
oauthConsentRouter.post(
  '/oauth/authorization/:id/deny',
  requireAuth,
  async (req, res) => {
    const request = await pendingRequest(String(req.params.id))
    await OAuthAuthorizationModel.deleteOne({ _id: request._id })

    res.json({
      redirectTo: redirectWith(request.redirectUri, request.state, {
        error: 'access_denied',
        error_description: 'The user declined the request',
      }),
    })
  },
)
