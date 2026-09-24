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
import { Router, type Request } from 'express'
import {
  createOAuthMetadata,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js'
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js'
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js'
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js'
import { requireAuth } from '../middleware/auth'
import { HttpError } from '../middleware/error'
import { OAuthAuthorizationModel } from '../models/oauth-authorization'
import { OAuthClientModel } from '../models/oauth-client'
import { UserModel } from '../models/user'
import {
  provider,
  supportedScopes,
  consentCookieName,
  clearConsentCookie,
} from '../oauth/provider'
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  generateToken,
  hashToken,
} from '../oauth/store'
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

/**
 * Where the OAuth endpoints live, and why they are not at the root.
 *
 * The SDK's own `mcpAuthRouter` puts them at `/authorize`, `/token`,
 * `/register` and `/revoke` — and this application already has a `/register`
 * **page**, where a person signs up. Mounting the two at one path is not a
 * near miss: the registration endpoint answers anything that is not a POST
 * with 405, so `GET /register` stopped returning the sign-up screen and
 * returned a method error instead. In production, where Express serves the
 * SPA, that took out the whole page.
 *
 * A prefix costs nothing, because a client never guesses these paths. It reads
 * them from the metadata document (RFC 8414), which is the entire reason that
 * document exists — so the endpoints can live wherever the deployment needs
 * them to, as long as the metadata says so. Only the `.well-known` documents
 * have a fixed location, and those stay at the root where the standard puts
 * them.
 */
export const OAUTH_PREFIX = '/oauth'

const endpoint = (name: string): string =>
  `${issuerOrigin()}${OAUTH_PREFIX}/${name}`

/** The metadata every endpoint path is taken from, so the two cannot drift. */
export const oauthMetadata = () => ({
  ...createOAuthMetadata({
    provider,
    issuerUrl: new URL(issuerOrigin()),
    scopesSupported: supportedScopes,
  }),
  authorization_endpoint: endpoint('authorize'),
  token_endpoint: endpoint('token'),
  registration_endpoint: endpoint('register'),
  revocation_endpoint: endpoint('revoke'),
})

/**
 * The machine-facing half: the four endpoints under their prefix, plus the
 * discovery documents at the root.
 *
 * Assembled from the SDK's own handlers rather than its all-in-one router,
 * which hard-codes the root paths. Every handler and the metadata shape are
 * still the SDK's — what is chosen here is only where they are mounted.
 */
export const oauthAuthRouter = (): Router => {
  const router = Router()
  const metadata = oauthMetadata()
  const path = (url: string): string => new URL(url).pathname

  router.use(
    path(metadata.authorization_endpoint),
    authorizationHandler({ provider }),
  )
  router.use(
    path(metadata.token_endpoint),
    // `rateLimit.max` is configurable (OAUTH_TOKEN_RATE_LIMIT, config/env.ts)
    // for the same reason DECK_VIEW_RATE_LIMIT is: a test suite that drives
    // real authorize/rotate/replay flows over real HTTP legitimately makes
    // more than the SDK's default 50 requests per 15 minutes in one run.
    // Unconfigured, this is the SDK's own default and nothing changes.
    tokenHandler({
      provider,
      rateLimit: { windowMs: 15 * 60 * 1000, max: env.OAUTH_TOKEN_RATE_LIMIT },
    }),
  )
  router.use(
    path(metadata.registration_endpoint!),
    clientRegistrationHandler({ clientsStore: provider.clientsStore }),
  )
  router.use(
    path(metadata.revocation_endpoint!),
    revocationHandler({ provider }),
  )

  // At the root, and advertising the prefixed endpoints above.
  router.use(
    mcpAuthMetadataRouter({
      oauthMetadata: metadata,
      resourceServerUrl: new URL(resourceUrl()),
      resourceName: 'Slide Machine',
      scopesSupported: supportedScopes,
    }),
  )

  return router
}

export const oauthConsentRouter = Router()

/**
 * A value `browserNonceHash` can never equal, so a missing binding cookie
 * falls through to the same "not found" outcome as every other refusal
 * rather than getting a query with no hash condition at all (which would
 * match any row with any nonce). `hashToken` output is 64 lower case hex
 * characters; this is neither hex nor that length.
 */
const NO_CONSENT_COOKIE = 'no-consent-cookie'

/**
 * The HMAC the parked row must carry for this request to be answerable from
 * this browser (finding 1a, docs/plans/OAUTH_CONSENT_SECURITY.md).
 *
 * The cookie is named after the request id (`consentCookieName`,
 * oauth/provider.ts — root cause C4, rework round 1), so there is no id to
 * split back out of the value: whichever cookie answers to *this* id's name
 * is the only one that could ever be relevant, and its value is the raw
 * nonce directly.
 */
const browserNonceHash = (req: Request, id: string): string => {
  const raw = req.cookies?.[consentCookieName(id)]
  if (typeof raw !== 'string' || !raw) return NO_CONSENT_COOKIE
  return hashToken(raw)
}

/**
 * Loads a pending request, refusing anything that is not one.
 *
 * Already-approved, expired and missing requests are refused identically —
 * and so, now, is a request that exists and is still open but was not parked
 * by this browser (finding 1a). All four are folded into one query rather
 * than checked in a second step, so there is no way for a distinguishing
 * error to slip in later: the binding check is not an extra `if`, it is a
 * fourth condition next to the three that were already here.
 *
 * A malformed id (not an ObjectId) makes `findOne` throw a CastError rather
 * than resolve to null, which the `.catch` here turns back into the same
 * refusal instead of letting it surface as a 500 — a shape nothing else in
 * this function produces, and so one an attacker could otherwise use to tell
 * "not a valid id" apart from everything else.
 */
const pendingRequest = async (req: Request, id: string) => {
  const request = await OAuthAuthorizationModel.findOne({
    _id: id,
    codeHash: { $exists: false },
    expiresAt: { $gt: new Date() },
    browserNonceHash: browserNonceHash(req, id),
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
 * The redirect target, in the most specific readable form available
 * (finding 1b / root cause D1, rework round 1).
 *
 * `origin` rather than `hostname`: for a loopback client (RFC 8252) the
 * *port* is the only thing telling two of them apart, and `hostname` drops
 * it. For a custom-scheme redirect URI — which registers just fine, the
 * SDK's schema only refuses `javascript:`/`data:`/`vbscript:` — `hostname`
 * is actively misleading rather than merely incomplete: `myapp://cb/x`
 * yields `cb`, an attacker-chosen string shaped exactly like a real host,
 * and `com.example.app:/oauth2redirect` (no authority at all) yields the
 * empty string, rendering "Access will be sent to .". `origin` fails more
 * honestly for the second case — WHATWG URL gives the literal string
 * `"null"` for a non-special scheme with no authority — which is why that
 * case falls back to the whole URI instead: something a person can actually
 * read beats a word that looks like an answer but is not one.
 */
const redirectDisplay = (uri: string): string => {
  try {
    const origin = new URL(uri).origin
    return origin && origin !== 'null' ? origin : uri
  } catch {
    return uri
  }
}

/**
 * What the consent screen shows: who is asking, for what, to which account,
 * and where the answer goes.
 *
 * The client's name is whatever it registered, so it is a label and never a
 * claim — anything may register under any name. That is a real limitation of
 * open registration, and the reason the screen also says which account is
 * about to be connected and the redirect target (finding 1b,
 * docs/plans/OAUTH_CONSENT_SECURITY.md): a link the user's own browser
 * genuinely started passes every server-side check there is, so these two
 * facts are the only defence left, and they are read straight off the parked
 * row and the signed-in session rather than trusted from anywhere the
 * assistant could reach.
 */
oauthConsentRouter.get(
  '/oauth/authorization/:id',
  requireAuth,
  async (req, res) => {
    const request = await pendingRequest(req, String(req.params.id))
    const [client, user] = await Promise.all([
      OAuthClientModel.findOne({ clientId: request.clientId }),
      UserModel.findById(req.userId),
    ])
    if (!user) {
      // The only way `requireAuth` can verify a token yet name an account
      // that does not load: a session whose account was deleted after the
      // JWT was signed (root cause D2). The earlier version rendered a
      // hardcoded English "your account" spliced into a translated
      // sentence — wrong on its own — and, worse, *affirmed* that a
      // connection was about to happen instead of refusing one. Treat it
      // exactly like any other invalid session.
      throw new HttpError(401, 'unauthorized', 'Sign in to continue')
    }

    res.json({
      clientName: client?.clientName ?? 'An unnamed assistant',
      scopes: request.scopes.map(scope => ({
        scope,
        description:
          SCOPE_DESCRIPTIONS[scope as Scope] ?? 'An unrecognised permission',
      })),
      account: user.email,
      redirectTarget: redirectDisplay(request.redirectUri),
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
    const request = await pendingRequest(req, String(req.params.id))

    const code = generateToken()
    // Re-based on the answer, not on the request. The window a person had to
    // decide is over; the code now gets its own full window, so someone who
    // read the screen carefully does not hand their assistant a credential
    // that is about to expire.
    const claimed = await OAuthAuthorizationModel.findOneAndUpdate(
      { _id: request._id, codeHash: { $exists: false } },
      {
        $set: {
          codeHash: hashToken(code),
          userId: req.userId,
          expiresAt: new Date(
            Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
          ),
        },
      },
    )
    if (!claimed) {
      throw new HttpError(
        409,
        'already_answered',
        'This authorization request was already answered',
      )
    }

    // The flow has an answer; the binding cookie's job is done.
    clearConsentCookie(res, request._id.toString())
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
    const request = await pendingRequest(req, String(req.params.id))
    await OAuthAuthorizationModel.deleteOne({ _id: request._id })

    clearConsentCookie(res, request._id.toString())
    res.json({
      redirectTo: redirectWith(request.redirectUri, request.state, {
        error: 'access_denied',
        error_description: 'The user declined the request',
      }),
    })
  },
)
