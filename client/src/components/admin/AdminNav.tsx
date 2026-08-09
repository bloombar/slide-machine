/**
 * Admin console navigation: a tab bar linking every admin section, shown
 * below the app header on all admin pages. The section the admin is in is
 * underlined — detail pages count as their section, so a user's page keeps
 * "Users" marked current.
 */
import { Link, useLocation } from 'react-router'

/** An admin section: where its tab points, its label, and the path
 * prefixes that count as being inside it. */
export type AdminLink = {
  to: string
  label: string
  prefixes: string[]
}

/** The admin console's sections in nav order; extend as pages are added.
 * "Users" lives at the console root, so it lists its detail prefix rather
 * than matching everything nested under /app/admin. */
export const ADMIN_LINKS: AdminLink[] = [
  { to: '/app/admin', label: 'Users', prefixes: ['/app/admin/users'] },
  {
    to: '/app/admin/projects',
    label: 'Projects',
    prefixes: ['/app/admin/projects'],
  },
  { to: '/app/admin/decks', label: 'Lectures', prefixes: ['/app/admin/decks'] },
  { to: '/app/admin/cost', label: 'Cost', prefixes: ['/app/admin/cost'] },
  { to: '/app/admin/logs', label: 'Admin Logs', prefixes: ['/app/admin/logs'] },
  {
    to: '/app/admin/settings-logs',
    label: 'User Logs',
    prefixes: ['/app/admin/settings-logs'],
  },
]

/** True when the current path is the section's own page or one nested
 * under it (a detail page). */
const isCurrent = (link: AdminLink, pathname: string): boolean =>
  pathname === link.to ||
  link.prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

export default function AdminNav() {
  const { pathname } = useLocation()
  return (
    // No overflow container: it would compute overflow-y to auto and show a
    // scrollbar for the 1px the tabs' -mb-px overlaps the border. The tabs
    // wrap instead if a narrow screen can't fit them.
    <nav
      aria-label="Admin"
      className="-mt-2 mb-6 flex flex-wrap gap-1 border-b border-slate-200"
    >
      {ADMIN_LINKS.map(link => {
        const current = isCurrent(link, pathname)
        return (
          <Link
            key={link.to}
            to={link.to}
            aria-current={current ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${
              current
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
