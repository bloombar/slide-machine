/**
 * Links into the app for a lecture, so an assistant working over MCP can hand
 * the instructor somewhere to look at what it just changed (docs/MCP.md §4).
 *
 * A link rather than a rendered picture, deliberately. The viewer at
 * `/d/:permalinkSlug` is public-shell but not public data: it fetches the deck
 * with the browser's own session, so a private lecture opens for its owner and
 * refuses everyone else. That is the ordinary sign-in the instructor already
 * has, which is why nothing here is signed, tokenised, or time-limited — the
 * URL grants no access on its own.
 *
 * The slide reference is a query parameter and not a fragment on purpose. A
 * fragment never reaches the server, and `RequireAuth` carries only
 * `pathname + search` when it sends a signed-out visitor to sign in — so a
 * `#slide` would be dropped on the way back if the viewer route is ever
 * guarded.
 */
import { SLIDE_PARAM } from '@slide-machine/shared'
import { configuredAppOrigin } from './app-origin'

/**
 * Where a lecture can be opened, optionally on one slide.
 *
 * Undefined when no app origin is configured (local dev without
 * `PUBLIC_BASE_URL` or `CLIENT_APP_URL`): a relative path is useless in a chat
 * window somewhere else, so the caller leaves the link out instead of offering
 * one that goes nowhere.
 */
export const lectureUrl = (
  permalinkSlug: string,
  slideId?: string,
): string | undefined => {
  const origin = configuredAppOrigin()
  if (!origin || !permalinkSlug) return undefined
  const base = `${origin}/d/${encodeURIComponent(permalinkSlug)}`
  return slideId
    ? `${base}?${SLIDE_PARAM}=${encodeURIComponent(slideId)}`
    : base
}
