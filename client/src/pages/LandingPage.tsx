/**
 * Public landing page: product tagline and a sign-in call to action.
 * Signed-in users are taken straight to their home screen instead.
 */
import { Link, Navigate } from 'react-router'
import { LogIn } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

export default function LandingPage() {
  const { status } = useAuth()

  if (status === 'restoring') {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        Loading…
      </div>
    )
  }
  if (status === 'authenticated') {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Slide Machine V2</h1>
      <p className="text-slate-600">Speak freely — the slides will follow.</p>
      <Link
        to="/login"
        className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-3 font-medium text-white"
      >
        <LogIn className="h-5 w-5" aria-hidden />
        Sign in to get started
      </Link>
    </div>
  )
}
