/**
 * Sign-in form (AUTH-1 email+password). Server-side validation is
 * authoritative; errors from the API render inline.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/http'

export default function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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
    <main className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
      <form
        onSubmit={onSubmit}
        className="flex w-80 flex-col gap-4 rounded-xl bg-slate-800 p-8"
      >
        <h1 className="text-2xl font-bold">Sign in</h1>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="rounded-md bg-slate-700 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="rounded-md bg-slate-700 px-3 py-2 text-slate-100"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-medium disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-sm text-slate-400">
          No account?{' '}
          <Link to="/register" className="text-indigo-400">
            Create one
          </Link>
        </p>
      </form>
    </main>
  )
}
