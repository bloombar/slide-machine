/**
 * Where to send someone back to after an auth journey that leaves the SPA
 * (AUTH-8).
 *
 * "Continue with Google" is a top-level navigation to the server's OAuth
 * start route, so React state and router history are gone by the time the
 * browser comes back — and the callback always lands on `/app`. Someone who
 * opened the sign-in dialog on a lecture and chose Google would therefore
 * lose the lecture, which is the one thing that dialog exists to prevent.
 *
 * The path is parked in sessionStorage rather than sent through a query
 * parameter: the only writer is our own code in this tab, the value never
 * crosses an origin, and nothing an attacker controls reaches it. It is
 * still validated on the way out — an unvalidated redirect target read back
 * from storage is a habit worth not forming, and a browser extension or a
 * future caller could put anything there.
 *
 * Costs, both accepted: `/app` paints for a moment before the jump, and the
 * path is lost if consent completes in a different tab (sessionStorage is
 * per-tab).
 *
 * `/register` and `/forgot-password` opened from inside the dialog lose the
 * lecture the same way, which is why this is a shared helper and not two
 * lines inside the Google button.
 */

const KEY = 'sm:auth-return'

/**
 * Whether a stored value is a safe same-origin path to navigate to.
 *
 * Rejects anything that could leave this origin: it must start with a single
 * `/` (so `//evil.test` and the `/\evil.test` some parsers treat the same way
 * are out), carry no scheme, and resolve back to this very origin.
 */
export const isSafeReturnPath = (value: unknown): value is string => {
  if (typeof value !== 'string' || value === '') return false
  if (value[0] !== '/') return false
  if (value[1] === '/' || value[1] === '\\') return false
  // A scheme before any path separator — "javascript:", "https:" and friends
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  try {
    return new URL(value, window.location.origin).origin === location.origin
  } catch {
    return false
  }
}

/** Parks the page the visitor is on, to come back to after an OAuth round
 * trip. Call immediately before the navigation that leaves the app. */
export const rememberReturnPath = (path: string): void => {
  try {
    if (isSafeReturnPath(path)) sessionStorage.setItem(KEY, path)
  } catch {
    // Storage blocked (some privacy modes throw on access): the journey
    // still works, it just lands on the default page.
  }
}

/** Reads the parked path and clears it, so it is used exactly once and a
 * later plain visit to /app is never redirected. */
export const takeReturnPath = (): string | null => {
  try {
    const stored = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return isSafeReturnPath(stored) ? stored : null
  } catch {
    return null
  }
}
