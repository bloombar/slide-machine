/**
 * Hamburger menu for the primary nav, shown on every page (both shells).
 * Its button sits where the brand icon used to; clicking it opens a small
 * dropdown with Home and Profile links and a log-out action. Signed out,
 * it offers Home and Log in instead. Closes on outside click or Escape.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Menu, LogOut, LogIn, ChevronRight } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { ADMIN_LINKS } from '../admin/AdminNav'

/** Admin entry, mounted only while the dropdown is open so the status
 * check fires at most once per session and only for users who open the
 * menu; non-admins render nothing. Admins get a single "Admin" item
 * whose flyout submenu (hover, or click for keyboard/touch) lists every
 * admin section. */
function AdminMenuItem({
  className,
  onNavigate,
}: {
  className: string
  onNavigate: () => void
}) {
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  if (!isAdmin) return null
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`${className} justify-between`}
      >
        Admin
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        // Outer wrapper's left padding bridges the gap to the button so the
        // mouse never crosses a non-hoverable dead zone (which would fire
        // onMouseLeave and close the flyout mid-move).
        <div className="absolute top-0 left-full z-50 pl-1">
          <div
            role="menu"
            aria-label="Admin"
            className="w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          >
            {ADMIN_LINKS.map(link => (
              <Link
                key={link.to}
                to={link.to}
                role="menuitem"
                onClick={onNavigate}
                className={className}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

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
                Profile
              </Link>
              <AdminMenuItem
                className={item}
                onNavigate={() => setOpen(false)}
              />
              <button
                role="menuitem"
                onClick={() => void doLogout()}
                className="mt-1 flex w-full items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
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
