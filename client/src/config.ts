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
  /** Show the "Continue with Google" button (AUTH-1). Gated on the public
   * client id, so the button appears only once Google sign-in is set up. */
  googleAuthEnabled: Boolean(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID),
  /** Placeholder name shown for a titleless project (e.g. the default one
   * created for a user's first lecture). Blank env falls back too. */
  defaultProjectTitle:
    import.meta.env.VITE_DEFAULT_PROJECT_TITLE || 'Default project',
} as const
