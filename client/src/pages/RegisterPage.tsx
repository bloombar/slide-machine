/**
 * Registration form (AUTH-1 email+password). Registration signs the user
 * in immediately; email verification (AUTH-3) arrives in a later phase.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/http'

export default function RegisterPage() {
  const { status, register } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
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
      await register(email, password, displayName)
      navigate('/app', { replace: true })
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
        <h1 className="text-2xl font-bold">Create account</h1>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Display name
          <input
            required
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="rounded-md bg-slate-700 px-3 py-2 text-slate-100"
          />
        </label>
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
            minLength={8}
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
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-sm text-slate-400">
          Already registered?{' '}
          <Link to="/login" className="text-indigo-400">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  )
}
