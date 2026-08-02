/**
 * The absolute origin the *app* is reached at, for building URLs an outside
 * service will send the browser back to (BILL-2 checkout and portal returns).
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

export const appOrigin = (req: Request): string =>
  env.CLIENT_APP_URL ??
  env.PUBLIC_BASE_URL ??
  `${req.protocol}://${req.get('host')}`
