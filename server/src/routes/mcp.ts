/**
 * The MCP endpoint (docs/MCP.md) — one POST that an external AI assistant
 * speaks JSON-RPC to.
 *
 * There is deliberately very little here. The token decides who is calling and
 * what they were granted; the SDK's transport handles the protocol; the tools
 * do the work through the action layer, which authorizes and meters exactly as
 * it does for the app's own front end. An agent call is an ordinary call by
 * the account that authorized it.
 *
 * ## Two fences, doing different jobs
 *
 * The token carries **scopes**, which say what this assistant was allowed to
 * do — read, or read and write. That is the user's answer on the consent
 * screen, and it is checked per tool: a read-only grant cannot reach a tool
 * that writes, even though the account behind it could.
 *
 * Underneath, the **tool surface** says what any assistant may do at all
 * (mcp/forbidden.ts). No scope reaches deletion, sharing or publishing,
 * because those are not tools. Scope narrows what is on the surface; it never
 * widens it, and the two are not alternatives — a token with every scope is
 * still confined to ten tools.
 *
 * ## Why the 401 carries a header
 *
 * An assistant that has never seen this server needs to discover where to ask
 * for a token. The `WWW-Authenticate` header on a refusal names the protected
 * resource metadata document (RFC 9728), which names the authorization server,
 * which advertises its own endpoints — so a client nobody arranged can get
 * from "refused" to a working connection with no configuration. That chain is
 * the whole of "remote" in the requirement.
 *
 * ## Why the rate limit
 *
 * Plan caps bound what an account can spend, not how often it can ask
 * (docs/MCP.md §6). An agent in a loop calls faster than any person clicks,
 * and the read tools are free — so nothing in the billing layer would ever
 * slow one down. This is the nuisance guard for that.
 */
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { createRateLimiter } from '../lib/rate-limit'
import { HttpError } from '../middleware/error'
import { createMcpServer } from '../mcp/server'
import { provider } from '../oauth/provider'
import { resourceUrl } from './oauth'

export const MCP_PATH = '/mcp'

/**
 * Per account, not per address: an assistant's calls arrive from a vendor's
 * servers, so several instructors can share one IP and one instructor's
 * runaway loop must not lock the others out.
 *
 * Generous on purpose. A legitimate batch — restyling fourteen lectures, one
 * call each — has to fit comfortably inside it, so the limit catches a loop
 * rather than a busy afternoon.
 */
export const mcpRateLimiter = createRateLimiter({
  limit: 240,
  windowMs: 60_000,
})

export const mcpRouter = Router()

mcpRouter.post(
  MCP_PATH,
  // No `requiredScopes` here: a token needs *some* valid grant to reach the
  // endpoint, and which scope each call needs is decided per tool inside the
  // server, where the tool that was asked for is known.
  (req, res, next) =>
    requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
        new URL(resourceUrl()),
      ),
    })(req, res, next),
  async (req, res) => {
    // Set by verifyAccessToken; the token is bound to one account and carries
    // what the user approved on the consent screen.
    const auth = req.auth
    const userId = auth?.extra?.userId as string | undefined
    /* c8 ignore next 4 -- unreachable: requireBearerAuth refuses before this,
       and every token this server mints carries a userId. The guard is here so
       a change to the provider cannot silently dispatch with no user. */
    if (!auth || !userId) {
      throw new HttpError(401, 'invalid_token', 'Token is not bound to a user')
    }

    if (!mcpRateLimiter.take(userId)) {
      throw new HttpError(
        429,
        'rate_limited',
        'Too many requests from this account; slow down and try again shortly',
      )
    }

    // Stateless: a server and transport per request, closed when the response
    // is. Nothing about answering a tool call needs to outlive it, and keeping
    // no session map means nothing to leak and no instance affinity to arrange.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    // `channel: 'agent'` is the only mark an agent call carries. Everything
    // else about it is deliberately identical to a call from the app's own
    // front end — same account, same authorization, same metering — so this
    // is the single point where the distinction can be recorded at all, and
    // it is what lets the cost ledger answer afterwards which work an
    // assistant caused (docs/MCP.md §6).
    const server = createMcpServer(
      {
        userId,
        requestId: randomUUID(),
        origin: resourceUrl(),
        channel: 'agent',
      },
      auth.scopes,
    )

    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    await server.connect(transport)
    // The body is already parsed by the app's JSON middleware, so it is handed
    // over rather than read again from the stream.
    await transport.handleRequest(req, res, req.body)
  },
)
