/**
 * A standard desktop-browser User-Agent for outbound image-source requests.
 * Some providers (notably Wikimedia Commons) rate-limit or reject requests
 * that omit a User-Agent, silently dropping that whole source (IMG-2); a
 * common browser string keeps those requests served like an ordinary client.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
