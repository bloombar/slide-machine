/**
 * Authenticated app layout: sticky primary navigation over a centered
 * content column. The left of the nav holds a hamburger menu (Home,
 * Profile, log out); pages can place their own controls on the right via
 * ShellActions. Presentation surfaces (live session, deck viewer)
 * intentionally do not use this shell.
 */
import { Link, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import HealthFooter from './HealthFooter'
import ShellMenu from './ShellMenu'
import { ShellDrawerFrame } from './ShellDrawer'
import badgeUrl from '../../assets/badge.png'
import { useShellTitleSlot } from './ShellTitle'
import { useShellActionsSlot } from './ShellActions'

export default function AppShell() {
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
                next to it are a single home target, not two adjacent
                links to the same page. */}
              <Link
                to="/app"
                aria-label={t('nav.brandHome')}
                className="flex items-center gap-2 font-semibold whitespace-nowrap"
              >
                <img src={badgeUrl} alt="" aria-hidden className="h-7 w-auto" />
                {t('nav.brand')}
              </Link>
              {shellTitle?.active && (
                <span
                  aria-hidden
                  className="font-semibold text-slate-300 select-none"
                >
                  /
                </span>
              )}
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
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
        <HealthFooter />
      </div>
    </ShellDrawerFrame>
  )
}
