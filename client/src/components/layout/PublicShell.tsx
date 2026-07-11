/**
 * Public layout (landing, sign-in, register, permalink viewer): logo on
 * the left, profile icon on the right — the icon opens the profile when
 * signed in and the login screen otherwise.
 */
import { Link, Outlet } from 'react-router'
import { Presentation, User } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import HealthFooter from './HealthFooter'

export default function PublicShell() {
  const { status } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Presentation className="h-5 w-5 text-indigo-600" aria-hidden />
            The Slide Machine
          </Link>
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 sm:gap-2"
          >
            <Link
              to={status === 'authenticated' ? '/app/profile' : '/login'}
              aria-label="Profile"
              className="flex items-center rounded-md px-3 py-2 text-slate-600 hover:text-slate-900"
            >
              <User className="h-5 w-5" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex w-full flex-1 flex-col">
        <Outlet />
      </main>
      <HealthFooter />
    </div>
  )
}
