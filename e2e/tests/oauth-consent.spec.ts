/**
 * The OAuth consent flow, end to end against a real browser (docs/MCP.md §5,
 * docs/plans/OAUTH_CONSENT_SECURITY.md finding 1).
 *
 * Why this spec exists when `oauth-mcp.test.ts` (server/test/integration)
 * already drives the same HTTP calls: the HIGH fix's load-bearing property is
 * the binding cookie's own attributes — `__Host-`, `Secure`, `SameSite=Lax`,
 * `Path=/` — and `supertest` (what the integration suite uses) implements
 * none of them. Those integration tests hand-carry the cookie with
 * `.set('Cookie', ...)`, so they would pass identically even if the cookie
 * could never actually be stored or sent by a real browser at all. Only a
 * real browser's own cookie jar can tell that apart, which is what this spec
 * is for. Everything else about the flow (scopes, PKCE, single-use codes) is
 * already covered server-side and is not re-proven here.
 */
import { createHash, randomBytes } from 'node:crypto'
import { test, expect, type Browser, type Page } from './fixtures'

const stamp = Date.now()
const password = 'sturdy-passw0rd'

/** A PKCE pair, the way a real assistant generates one. */
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** A fresh browser context and page — a new browser, cookie jar included. */
const newPage = async (browser: Browser): Promise<Page> => {
  const context = await browser.newContext()
  return context.newPage()
}

/** Registers a fresh account on `page` and lands it on /app. */
const signUp = async (
  page: Page,
  account: { email: string; name: string },
): Promise<void> => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(account.name)
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

/**
 * Registers an assistant the way a real one introduces itself (RFC 7591),
 * through the real `/oauth/register` HTTP endpoint rather than calling the
 * store directly — this spec is about what a browser can actually do, and a
 * client that cannot register is a client that cannot connect.
 */
const registerClient = async (
  page: Page,
  redirectUri: string,
): Promise<string> => {
  const res = await page.request.post('/oauth/register', {
    data: {
      client_name: 'E2E Test Assistant',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { client_id: string }
  return body.client_id
}

/** Builds the `/oauth/authorize` URL a real assistant would send the
 * browser to. */
const authorizeUrl = (
  clientId: string,
  redirectUri: string,
  challenge: string,
) =>
  `/oauth/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'lectures.read',
  }).toString()}`

/** Matches the browser's final landing on the assistant's own callback,
 * carrying whatever query string the consent answer produced. */
const callbackUrlPattern = (redirectUri: string): RegExp =>
  new RegExp(`^${redirectUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?`)

test('a signed-in user completes the consent flow, and the assistant can redeem the code', async ({
  page,
  baseURL,
}) => {
  const user = { email: `e2e-oauth-${stamp}@example.com`, name: 'Oauth Tester' }
  await signUp(page, user)

  // A path this same server happily falls back to index.html for
  // (server/src/static.ts serves the SPA for any non-/api GET), so the
  // browser's navigation actually lands somewhere rather than failing to
  // connect — what matters is the query string the redirect carries, not
  // what renders there.
  const redirectUri = `${baseURL}/oauth-e2e-callback`
  const clientId = await registerClient(page, redirectUri)
  const { verifier, challenge } = pkce()

  await page.goto(authorizeUrl(clientId, redirectUri, challenge))

  // Landed on the consent screen, naming the assistant and this account —
  // the redirect from `authorize` only succeeds at all if the browser
  // actually stored and is now sending back the `__Host-` binding cookie
  // (routes/oauth.ts's `pendingRequest` refuses identically to a missing
  // request otherwise, which would render the "expired" message instead).
  await expect(
    page.getByRole('heading', { name: 'Connect an assistant' }),
  ).toBeVisible()
  await expect(
    page.getByText('E2E Test Assistant is asking to connect'),
  ).toBeVisible()
  await expect(
    page.getByText(`This will connect as ${user.email}`),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Allow', exact: true }).click()

  // The consent page hands off with `window.location.assign`, a real
  // navigation — the browser ends up at the assistant's own redirect URI,
  // carrying the authorization code.
  await page.waitForURL(callbackUrlPattern(redirectUri))
  const code = new URL(page.url()).searchParams.get('code')
  expect(code).toBeTruthy()

  // The code is real: the assistant (a `page.request` call, standing in for
  // whatever HTTP client the assistant uses) can redeem it with the PKCE
  // verifier it held all along.
  const tokenRes = await page.request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    },
  })
  expect(tokenRes.status()).toBe(200)
  const tokens = (await tokenRes.json()) as {
    access_token: string
    refresh_token: string
  }
  expect(tokens.access_token).toBeTruthy()
  expect(tokens.refresh_token).toBeTruthy()
})

test('refuses to read or answer a parked request from a browser that did not start it', async ({
  browser,
  baseURL,
}) => {
  // Two browser contexts, each its own cookie jar — standing in for two
  // different browsers/people, which is what the binding cookie actually
  // distinguishes. `requestId` alone is not a secret (it is a Mongo
  // ObjectId in the URL both `GET` and the browser's own address bar can
  // see), so the account behind the second browser being a stranger's own —
  // not the starter's — is what the original attack
  // (docs/plans/OAUTH_CONSENT_SECURITY.md, finding 1) exploited: whichever
  // signed-in account reached the row could answer it.
  const starterPage = await newPage(browser)
  const strangerPage = await newPage(browser)
  await signUp(starterPage, {
    email: `e2e-oauth-starter-${stamp}@example.com`,
    name: 'Flow Starter',
  })
  await signUp(strangerPage, {
    email: `e2e-oauth-stranger-${stamp}@example.com`,
    name: 'Flow Stranger',
  })

  const redirectUri = `${baseURL}/oauth-e2e-callback`
  const clientId = await registerClient(starterPage, redirectUri)
  const { challenge } = pkce()

  await starterPage.goto(authorizeUrl(clientId, redirectUri, challenge))
  const requestId = new URL(starterPage.url()).searchParams.get('request')!
  expect(requestId).toBeTruthy()

  // The stranger's browser never received the `__Host-` cookie `authorize`
  // set for the starter's — loading the same consent URL there must refuse
  // identically to a missing or already-answered request, not read or
  // answer it.
  await strangerPage.goto(`/oauth/consent?request=${requestId}`)
  await expect(
    strangerPage.getByText(
      'This request has expired or was already answered. Ask the assistant to try connecting again.',
    ),
  ).toBeVisible()

  // Positive control, so the refusal above is not read as vacuous (any
  // request in this state, or a page that always shows this text, would
  // pass it too): handing the stranger's browser the *exact same* cookie
  // the starter's holds — same name, same value — makes the identical
  // request succeed. The only thing that changed is the cookie, so the
  // cookie is what was gating the refusal above, not something else about
  // the stranger's session or the request's state.
  const starterCookies = await starterPage.context().cookies()
  const bindingCookie = starterCookies.find(c =>
    c.name.startsWith('__Host-sm_oauth_consent_'),
  )
  expect(bindingCookie).toBeTruthy()
  await strangerPage.context().addCookies([bindingCookie!])
  await strangerPage.goto(`/oauth/consent?request=${requestId}`)
  await expect(
    strangerPage.getByRole('heading', { name: 'Connect an assistant' }),
  ).toBeVisible()

  // The starter's own browser — the one that started the flow, still
  // holding the cookie it was given — can also still answer it: the
  // refusal above was about the wrong browser, not about the request
  // itself having been spent by proving the control above.
  await starterPage.goto(`/oauth/consent?request=${requestId}`)
  await expect(
    starterPage.getByRole('heading', { name: 'Connect an assistant' }),
  ).toBeVisible()
  await starterPage.getByRole('button', { name: 'Allow', exact: true }).click()
  await starterPage.waitForURL(callbackUrlPattern(redirectUri))
  expect(new URL(starterPage.url()).searchParams.get('code')).toBeTruthy()
})
