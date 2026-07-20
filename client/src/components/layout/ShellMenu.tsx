/**
 * Hamburger menu for the primary nav, shown on every page (both shells).
 * Its button sits where the brand icon used to; clicking it opens a small
 * dropdown with Home and Profile links and a log-out action. Signed out,
 * it offers Home and Log in instead. Closes on outside click or Escape.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Menu, Home, User, LogOut, LogIn } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'

export default function ShellMenu() {
  const { status, logout } = useAuth()
  const authed = status === 'authenticated'
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside the menu or pressing Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const doLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/')
  }

  const item =
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100'

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex items-center rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <Link
            to={authed ? '/app' : '/'}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={item}
          >
            <Home className="h-4 w-4" aria-hidden />
            Home
          </Link>
          {authed ? (
            <>
              <Link
                to="/app/profile"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={item}
              >
                <User className="h-4 w-4" aria-hidden />
                Profile
              </Link>
              <button
                role="menuitem"
                onClick={() => void doLogout()}
                className={item}
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Log out
              </button>
            </>
          ) : (
            <Link
              to="/login"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={item}
            >
              <LogIn className="h-4 w-4" aria-hidden />
              Log in
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
