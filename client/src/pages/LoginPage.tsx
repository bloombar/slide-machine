/**
 * The sign-in page (AUTH-1). The form itself — email/password, Google,
 * legal notice, forgot-password/create-account links — is `SignInForm`
 * (AUTH-8), shared with the sign-in dialog; this page supplies its own
 * heading, card chrome, and what "signed in" navigates to next.
 */
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import SignInForm from '../components/SignInForm'
import NavLocaleSwitcher from '../i18n/NavLocaleSwitcher'

export default function LoginPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  // A failed Google callback redirects here with ?error=<code>
  const googleFailed =
    new URLSearchParams(location.search).get('error') === 'google_auth_failed'

  /**
   * Where signing in should land. A guard that turned someone away carries
   * the address they were headed for (RequireAuth), and so does a link out of
   * a page that could not show itself — a private lecture an assistant sent
   * someone to, say (docs/MCP.md). Absent one, the home page.
   */
  const destination =
    (location.state as { from?: string } | null)?.from ?? '/app'

  // Read here too, not just after a successful submit: signing in flips this
  // component to `authenticated` while it is still mounted, so this guard
  // renders before the navigate below can run. Sending it to /app would
  // silently drop the destination on every journey that had one.
  if (status === 'authenticated') return <Navigate to={destination} replace />

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <NavLocaleSwitcher />
      <div className="flex w-80 flex-col gap-4 rounded-lg border border-slate-200 p-8">
        <h1 className="text-2xl font-bold">{t('auth.signIn')}</h1>
        <SignInForm
          onSuccess={() => navigate(destination, { replace: true })}
          initialError={googleFailed ? t('auth.errors.google') : null}
        />
      </div>
    </div>
  )
}
