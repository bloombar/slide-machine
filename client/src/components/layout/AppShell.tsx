/**
 * Authenticated app layout: sticky primary navigation (Lucide icons,
 * labels appear at the sm breakpoint) over a centered content column.
 * Presentation surfaces (live session, deck viewer) intentionally do
 * not use this shell.
 */
import { Link, NavLink, Outlet } from 'react-router'
import { Presentation, User } from 'lucide-react'
import HealthFooter from './HealthFooter'

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'text-indigo-600' : 'text-slate-600 hover:text-slate-900'
  }`

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link to="/app" className="flex items-center gap-2 font-semibold">
            <Presentation className="h-5 w-5 text-indigo-600" aria-hidden />
            The Slide Machine
          </Link>
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 sm:gap-2"
          >
            <NavLink
              to="/app/profile"
              aria-label="Profile"
              className={navLinkClass}
            >
              <User className="h-5 w-5" aria-hidden />
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <HealthFooter />
    </div>
  )
}
