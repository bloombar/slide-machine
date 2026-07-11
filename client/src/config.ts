/**
 * Client configuration (SPEC TECH-5). All values come from VITE_-prefixed
 * env vars (client/.env committed defaults, client/.env.local overrides).
 * No secrets belong here — this file ships to the browser.
 */
const positiveInt = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export const config = {
  /** Empty string means same-origin — correct for dev proxy and production alike. */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  /** Max lectures listed per project on the home screen before "Show all". */
  homeLecturesLimit: positiveInt(import.meta.env.VITE_HOME_LECTURES_LIMIT, 3),
} as const
