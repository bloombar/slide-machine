/**
 * Sign-in form (AUTH-1 email+password). Server-side validation is
 * authoritative; errors from the API render inline.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/http'
import GoogleSignInButton from '../components/GoogleSignInButton'

export default function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // A failed Google callback redirects here with ?error=<code>
  const googleFailed =
    new URLSearchParams(location.search).get('error') === 'google_auth_failed'
  const [error, setError] = useState<string | null>(
    googleFailed ? 'Could not sign in with Google — try again' : null,
  )
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to="/app" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate((location.state as { from?: string } | null)?.from ?? '/app', {
        replace: true,
      })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong — try again',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="flex w-80 flex-col gap-4 rounded-lg border border-slate-200 p-8"
      >
        <h1 className="text-2xl font-bold">Sign in</h1>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <GoogleSignInButton action="Sign in" />
        <p className="text-sm text-slate-500">
          No account?{' '}
          <Link to="/register" className="text-indigo-600">
            Create one
          </Link>
        </p>
      </form>
    </div>
  )
}
