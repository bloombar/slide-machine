/**
 * Public layout (landing, sign-in, register, permalink viewer): a
 * hamburger menu on the left (Home, Profile / log out, or Log in when
 * signed out) and a right-hand action area pages fill via ShellActions.
 * Below the page, a footer row of links to the static pages, so the privacy
 * policy is one click away without opening the drawer.
 */
import { Link, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import HealthFooter from './HealthFooter'
import SiteFooter from './SiteFooter'
import ShellMenu from './ShellMenu'
import { ShellDrawerFrame } from './ShellDrawer'
import { getBadgeUrl } from './badge'
import { useShellTitleSlot } from './ShellTitle'
import { useShellActionsSlot } from './ShellActions'

export default function PublicShell() {
  const shellTitle = useShellTitleSlot()
  const shellActions = useShellActionsSlot()
  const { t } = useTranslation()

  return (
    <ShellDrawerFrame>
      <div className="flex min-h-screen flex-col bg-white text-slate-900">
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ShellMenu />
              {/* App badge and title are one link so the icon and the words
                next to it are a single home target, not two adjacent links to
                the same page. The badge is on every page, beside the
                hamburger; a page that teleports its own title — a lecture
                showing project / lecture / author — drops only the brand
                words, which the narrow header needs for the title. */}
              <Link
                to="/"
                aria-label={t('nav.brandHome')}
                className="flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap"
              >
                {/* Nudged down 3px so the hamburger and the title sit on
                  the badge's rounded rectangle rather than on its whole box:
                  the tail hangs below the bubble and pulls the optical
                  centre off the row. */}
                <img
                  src={getBadgeUrl()}
                  alt=""
                  aria-hidden
                  className="h-7 w-auto translate-y-[3px]"
                />
                {!shellTitle?.active && t('nav.brand')}
              </Link>
              <div
                ref={el => shellTitle?.setSlot(el)}
                className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden text-base font-semibold text-slate-700"
              />
            </div>
            <nav
              aria-label={t('nav.primary')}
              className="flex items-center gap-1 sm:gap-2"
            >
              <div
                ref={el => shellActions?.setSlot(el)}
                className="flex items-center gap-1"
              />
            </nav>
          </div>
        </header>
        <main className="flex w-full flex-1 flex-col">
          <Outlet />
        </main>
        <SiteFooter />
        <HealthFooter />
      </div>
    </ShellDrawerFrame>
  )
}
