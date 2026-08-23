/**
 * The MCP endpoint (docs/MCP.md) — one POST that an external AI assistant
 * speaks JSON-RPC to.
 *
 * There is deliberately very little here. Authentication decides who is
 * calling; the SDK's transport handles the protocol; the tools do the work
 * through the action layer, which authorizes and meters exactly as it does for
 * the app's own front end. The whole security story of this route is
 * "whatever `requireAuth` proved, and nothing more" — an agent call is an
 * ordinary call by the account that authorized it.
 *
 * ## Auth, and what is still missing
 *
 * This stage verifies the application's own bearer token, the same one the
 * React client carries. That is enough to build and test the tool surface
 * against, and it is **not** the model this feature ships with: a session
 * token means "this is the instructor," full stop — every permission they
 * have, no per-assistant revocation, and no record of which assistant is
 * calling. The OAuth authorization server that replaces it is the next stage
 * (docs/MCP.md §5), and it slots in here: the token check becomes a scope
 * check, and the 401 below starts carrying the `WWW-Authenticate` header that
 * points a client at the metadata it needs to start a flow.
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
import { requireAuth } from '../middleware/auth'
import { createRateLimiter } from '../lib/rate-limit'
import { HttpError } from '../middleware/error'
import { createMcpServer } from '../mcp/server'
import { appOrigin } from '../lib/app-origin'

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

mcpRouter.post(MCP_PATH, requireAuth, async (req, res) => {
  if (!mcpRateLimiter.take(req.userId!)) {
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
  const server = createMcpServer({
    userId: req.userId,
    requestId: randomUUID(),
    origin: appOrigin(req),
  })

  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  await server.connect(transport)
  // The body is already parsed by the app's JSON middleware, so it is handed
  // over rather than read again from the stream.
  await transport.handleRequest(req, res, req.body)
})
