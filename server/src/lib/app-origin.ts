/**
 * The absolute origin the *app* is reached at, for building URLs an outside
 * service — or an outside assistant — will send the browser to (BILL-2
 * checkout and portal returns; the deck links an MCP tool hands back).
 *
 * Configuration first, request last, and never a client-supplied header: a
 * return URL taken from `Origin` or `Referer` would let anyone hand a payment
 * provider somewhere else to land the user. `req.get('host')` is the host the
 * request actually arrived on, which is what routes/auth.ts already trusts for
 * OAuth redirects.
 *
 * `CLIENT_APP_URL` wins because in local dev the SPA runs on Vite (:5173)
 * while the API answers on :3000 — returning to the API port would land the
 * user on a page that does not exist.
 */
import type { Request } from 'express'
import { env } from '../config/env'

/**
 * The app origin as configured, for callers with no request in hand.
 *
 * Undefined when neither variable is set, which is a real state in local dev:
 * the caller must then leave the URL out rather than guess one. Guessing is
 * what `appOrigin` uses the request for, and a caller without a request has
 * nothing to guess from.
 */
export const configuredAppOrigin = (): string | undefined =>
  env.CLIENT_APP_URL ?? env.PUBLIC_BASE_URL

export const appOrigin = (req: Request): string =>
  configuredAppOrigin() ?? `${req.protocol}://${req.get('host')}`
