/**
 * Public landing page: product tagline, API health, and entry links.
 */
import { Link } from 'react-router'
import HealthBadge from '../components/HealthBadge'
import { useAuth } from '../auth/AuthContext'

export default function LandingPage() {
  const { status } = useAuth()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-slate-100">
      <h1 className="text-4xl font-bold tracking-tight">Slide Machine V2</h1>
      <p className="text-slate-400">Speak freely — the slides will follow.</p>
      <HealthBadge />
      <nav className="flex gap-4">
        {status === 'authenticated' ? (
          <Link
            to="/app"
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium"
          >
            Open the app
          </Link>
        ) : (
          <>
            <Link
              to="/login"
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-slate-700 px-4 py-2 font-medium"
            >
              Create account
            </Link>
          </>
        )}
      </nav>
    </main>
  )
}
