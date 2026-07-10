/**
 * Public layout (landing, sign-in, register): same branding and header
 * pattern as the app shell, with auth entry links on the right.
 */
import { Link, Outlet } from 'react-router'
import { LogIn, Presentation, UserPlus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'

export default function PublicShell() {
  const { status } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Presentation className="h-5 w-5 text-indigo-600" aria-hidden />
            Slide Machine
          </Link>
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 sm:gap-2"
          >
            {status === 'authenticated' ? (
              <Link
                to="/app"
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
              >
                Open the app
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  <LogIn className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Sign in</span>
                </Link>
                <Link
                  to="/register"
                  className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
                >
                  <UserPlus className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Create account</span>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex w-full flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
