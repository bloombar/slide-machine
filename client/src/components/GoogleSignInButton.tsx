/**
 * "Continue with Google" button for the sign-in and register pages
 * (AUTH-1). A plain link, not a fetch: it navigates the top window to the
 * server's OAuth start route, which redirects on to Google's consent
 * screen. Renders nothing until Google sign-in is configured
 * (config.googleAuthEnabled), so no dead button ever shows.
 */
import { config } from '../config'

/** Google's multicolour "G", inlined so the button needs no network. */
function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  )
}

interface Props {
  /** Verb shown in the label, e.g. "Sign in" or "Sign up". */
  action: string
}

export default function GoogleSignInButton({ action }: Props) {
  if (!config.googleAuthEnabled) return null
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        or
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <a
        href={`${config.apiBaseUrl}/api/auth/google/start`}
        className="flex items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
      >
        <GoogleGlyph />
        {action} with Google
      </a>
    </>
  )
}
