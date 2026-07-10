/**
 * Client configuration (SPEC TECH-5). All values come from VITE_-prefixed
 * env vars (.env.local, never committed). No secrets belong here — this
 * file ships to the browser.
 */
export const config = {
  /** Empty string means same-origin — correct for dev proxy and production alike. */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
} as const
