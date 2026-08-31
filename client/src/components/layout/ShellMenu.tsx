/**
 * Hamburger menu for the primary nav, shown on every page (both shells).
 * Its button sits where the brand icon used to; clicking it slides a drawer
 * in from the left, pushing the page aside, and morphs the hamburger into a
 * close icon. The drawer holds Home, Profile and Account settings links, the
 * static pages (About, feedback, and the two documents), and a log-out
 * action. Signed out, it offers Home and Log in in place of the account
 * links, and the static pages all the same. Closes on outside click or
 * Escape.
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LogOut, LogIn, ChevronRight } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { getFeedbackEnabled } from '../../runtime-config'
import { ADMIN_LINKS } from '../admin/AdminNav'
import { DRAWER_PX, DRAWER_WIDTH, useShellDrawer } from './ShellDrawer'
import { STATIC_GROUPS } from './staticLinks'

/** The admin entry's label. Hardcoded English, not a translation key: the
 * console it opens is English-only by design (docs/I18N.md), and so is the
 * way in. Kept out of JSX so the no-literal-string rule, which only reads
 * JSX, does not need a disable comment. */
const ADMIN_LABEL = 'Admin'

/** Rule between the admin entry and the everyday links around it. */
const SEPARATOR = 'my-1 border-t border-slate-200'

/** Where the toggle sits on screen, in viewport coordinates. */
type Anchor = { top: number; left: number; width: number; height: number }

const toAnchor = (box: DOMRect): Anchor => ({
  top: box.top,
  left: box.left,
  width: box.width,
  height: box.height,
})

/** Maps a box measured in the pushed-aside header back to where it sits
 * when the page is at rest, which is where the pinned button belongs. */
const shiftBack = (box: DOMRect): Anchor => ({
  ...toAnchor(box),
  left: box.left - DRAWER_PX,
})

/** Admin entry, mounted only once the drawer has been opened so the status
 * check fires at most once per session and only for users who open the
 * menu; non-admins render nothing, separators included. Admins get a single
 * "Admin" item, fenced off above and below, whose flyout submenu (hover, or
 * click for keyboard/touch) lists every admin section. Neither this item nor
 * ADMIN_LINKS' own labels are translated — every admin surface stays
 * English. */
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
    <>
      <div role="separator" className={SEPARATOR} />
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
      <div role="separator" className={SEPARATOR} />
    </>
  )
}

/**
 * The static-page entries, fenced off from the account links above them the
 * same way the admin entry is fenced from what surrounds it. "Send feedback"
 * drops out on a server that cannot send mail rather than opening a form
 * that would refuse the message; a group left with nothing in it renders no
 * rule either.
 *
 * The feedback link carries the page it was opened from, so a bug report
 * arrives knowing what it is about.
 */
function StaticMenuItems({
  className,
  from,
  onNavigate,
}: {
  className: string
  from: string
  onNavigate: () => void
}) {
  const mail = getFeedbackEnabled()
  return (
    <>
      {STATIC_GROUPS.map(group => {
        const links = group.filter(link => !link.needsMail || mail)
        if (links.length === 0) return null
        return (
          // A fragment rather than a wrapper, so every child of the panel is
          // a menu item or a separator and nothing else.
          <Fragment key={links[0]!.to}>
            <div role="separator" className={SEPARATOR} />
            {links.map(link => (
              <Link
                key={link.to}
                to={link.to}
                // Opened from the feedback page itself, there is nowhere to
                // send it back to and nothing to say it is about.
                state={
                  link.needsMail && from !== link.to ? { from } : undefined
                }
                role="menuitem"
                onClick={onNavigate}
                className={className}
              >
                {link.label}
              </Link>
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

export default function ShellMenu() {
  const { status, user, logout } = useAuth()
  const { t } = useTranslation()
  const authed = status === 'authenticated'
  const [open, setOpen] = useShellDrawer()
  // Latches on first open: the panel stays mounted so it can animate out,
  // but nothing inside it needs to exist before anyone asks for it.
  const [everOpened, setEverOpened] = useState(false)
  const navigate = useNavigate()
  // Where the menu was opened from, handed to the feedback form so a report
  // filed from a lecture says which lecture.
  const location = useLocation()
  const from = `${location.pathname}${location.search}`
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLSpanElement>(null)
  // Where the button sits in the header, so the open drawer can pin its
  // close button to that exact spot: the page slides out from under the
  // cursor, the control does not move.
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  // True once the toggle has been used, so focus follows the button as it
  // moves between header and drawer — but never on first paint.
  const moved = useRef(false)

  const toggle = () => {
    const box = slotRef.current?.getBoundingClientRect()
    // Measured in the header when closed, and in the header's shifted-aside
    // placeholder when open — hence the correction back to resting position.
    if (box) setAnchor(open ? shiftBack(box) : toAnchor(box))
    moved.current = true
    setEverOpened(true)
    setOpen(o => !o)
  }

  // Keep the keyboard on the toggle across the swap: header button and
  // drawer button are one control, rendered in two places.
  useEffect(() => {
    if (moved.current) buttonRef.current?.focus()
  }, [open])

  // A window resize moves the header button; follow it while open
  useEffect(() => {
    if (!open) return
    const onResize = () => {
      const box = slotRef.current?.getBoundingClientRect()
      if (box) setAnchor(shiftBack(box))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  // Close when clicking outside the panel and its button, or on Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
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
  }, [open, setOpen])

  const doLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/')
  }

  const item =
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100'

  // Bars of the hamburger, all three stacked on the centre line: closed,
  // the outer two sit 6px above and below it; open, they swing onto it and
  // cross while the middle one fades out.
  const bar =
    'absolute start-0 top-1/2 -mt-px h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ease-out motion-reduce:transition-none'

  const panel = (
    <div
      ref={panelRef}
      role="menu"
      aria-hidden={!open}
      inert={!open}
      // Links start below the header's height, clear of the close button
      // pinned over the top of the panel.
      //
      // Deliberately NOT a scroll container. The admin flyout opens beside
      // the drawer (`start-full`), so any overflow other than `visible`
      // clips it out of sight — and a scrollbar on one axis makes the other
      // one clip too. The panel is full-height, which is room enough for the
      // entries it holds.
      className={`fixed inset-y-0 start-0 z-50 ${DRAWER_WIDTH} border-e border-slate-200 bg-white p-2 pt-14 shadow-xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
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
          {/* Everything you can change about your own account (AUTH-5) */}
          <Link
            to="/app/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={item}
          >
            {t('nav.accountSettings')}
          </Link>
          {/* The static pages sit between the account links and the way into
              the admin console, which fences itself off again below them. */}
          <StaticMenuItems
            className={item}
            from={from}
            onNavigate={() => setOpen(false)}
          />
          {everOpened && (
            <AdminMenuItem className={item} onNavigate={() => setOpen(false)} />
          )}
        </>
      ) : (
        <>
          <Link
            to="/login"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={item}
          >
            <LogIn className="h-4 w-4" aria-hidden />
            {t('nav.logIn')}
          </Link>
          {/* Signed out too: a policy that needs an account to read is not a
              policy, and the feedback form is most useful to someone who
              cannot get in. */}
          <StaticMenuItems
            className={item}
            from={from}
            onNavigate={() => setOpen(false)}
          />
        </>
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
  )

  // One control in two homes: in the header while closed, pinned over the
  // open drawer at the very same screen position while open, so a second
  // click lands where the first one did.
  const toggleButton = (pinned: boolean) => (
    <button
      ref={buttonRef}
      aria-label={t('nav.menu')}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={toggle}
      style={
        pinned && anchor ? { top: anchor.top, left: anchor.left } : undefined
      }
      className={`flex items-center rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${
        pinned ? 'fixed z-50' : ''
      }`}
    >
      <span aria-hidden className="relative block h-4 w-5">
        <span className={`${bar} ${open ? 'rotate-45' : '-translate-y-1.5'}`} />
        <span
          className={`absolute start-0 top-1/2 -mt-px h-0.5 w-5 rounded-full bg-current transition-opacity duration-200 motion-reduce:transition-none ${
            open ? 'opacity-0' : 'opacity-100'
          }`}
        />
        <span className={`${bar} ${open ? '-rotate-45' : 'translate-y-1.5'}`} />
      </span>
    </button>
  )

  return (
    <>
      {/* The button's place in the header. While the drawer is open the
          button itself is pinned over the drawer instead, and this holds
          the gap open so the brand beside it does not slide over. */}
      <span ref={slotRef} className="flex shrink-0">
        {open ? (
          <span
            aria-hidden
            style={
              anchor
                ? { width: anchor.width, height: anchor.height }
                : undefined
            }
            className="block h-8 w-9"
          />
        ) : (
          toggleButton(false)
        )}
      </span>
      {createPortal(
        <>
          {panel}
          {/* After the panel, so it sits over it without a z-index race */}
          {open && toggleButton(true)}
        </>,
        document.body,
      )}
    </>
  )
}
