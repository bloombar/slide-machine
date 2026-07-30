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
import { useShellTitleSlot } from './ShellTitle'
import { useShellActionsSlot } from './ShellActions'

export default function AppShell() {
  const shellTitle = useShellTitleSlot()
  const shellActions = useShellActionsSlot()
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ShellMenu />
            <Link
              to="/app"
              aria-label={t('nav.brandHome')}
              className="font-semibold whitespace-nowrap"
            >
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
              className="flex min-w-0 flex-1 items-baseline gap-2 text-base font-semibold text-slate-700"
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
  )
}
