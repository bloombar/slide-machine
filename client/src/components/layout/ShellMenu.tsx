/**
 * Hamburger menu for the primary nav, shown on every page (both shells).
 * Its button sits where the brand icon used to; clicking it opens a small
 * dropdown with Home and Profile links and a log-out action. Signed out,
 * it offers Home and Log in instead. Closes on outside click or Escape.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Menu, LogOut, LogIn, ChevronRight } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { ADMIN_LINKS } from '../admin/AdminNav'

/** The admin entry's label. Hardcoded English, not a translation key: the
 * console it opens is English-only by design (docs/I18N.md), and so is the
 * way in. Kept out of JSX so the no-literal-string rule, which only reads
 * JSX, does not need a disable comment. */
const ADMIN_LABEL = 'Admin'

/** Admin entry, mounted only while the dropdown is open so the status
 * check fires at most once per session and only for users who open the
 * menu; non-admins render nothing. Admins get a single "Admin" item
 * whose flyout submenu (hover, or click for keyboard/touch) lists every
 * admin section. Neither this item nor ADMIN_LINKS' own labels are
 * translated — every admin surface stays English. */
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
        {ADMIN_LABEL}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        // Outer wrapper's inline-start padding bridges the gap to the
        // button so the mouse never crosses a non-hoverable dead zone
        // (which would fire onMouseLeave and close the flyout mid-move).
        <div className="absolute top-0 start-full z-50 ps-1">
          <div
            role="menu"
            aria-label={ADMIN_LABEL}
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
  const { status, user, logout } = useAuth()
  const { t } = useTranslation()
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
        aria-label={t('nav.menu')}
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
          className="absolute top-full start-0 z-50 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <Link
            to={authed ? '/app' : '/'}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={item}
          >
            {t('nav.home')}
          </Link>
          {authed ? (
            <>
              {/* The user's own profile page, the same one strangers see */}
              <Link
                to={user ? `/u/${user.id}` : '/app/profile'}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={item}
              >
                {t('nav.profile')}
              </Link>
              <AdminMenuItem
                className={item}
                onNavigate={() => setOpen(false)}
              />
            </>
          ) : (
            <Link
              to="/login"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={item}
            >
              <LogIn className="h-4 w-4" aria-hidden />
              {t('nav.logIn')}
            </Link>
          )}
          {authed && (
            <button
              role="menuitem"
              onClick={() => void doLogout()}
              className="mt-1 flex w-full items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              {t('nav.logOut')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
