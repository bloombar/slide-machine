/**
 * Public layout (landing, sign-in, register, permalink viewer): a
 * hamburger menu on the left (Home, Profile / log out, or Log in when
 * signed out) and a right-hand action area pages fill via ShellActions.
 */
import { Link, Outlet } from 'react-router'
import HealthFooter from './HealthFooter'
import ShellMenu from './ShellMenu'
import { useShellTitleSlot } from './ShellTitle'
import { useShellActionsSlot } from './ShellActions'

export default function PublicShell() {
  const shellTitle = useShellTitleSlot()
  const shellActions = useShellActionsSlot()

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ShellMenu />
            <Link
              to="/"
              aria-label="The Slide Machine — home"
              className="font-semibold whitespace-nowrap"
            >
              The Slide Machine
            </Link>
            <div
              ref={el => shellTitle?.setSlot(el)}
              className="flex min-w-0 flex-1 items-baseline gap-2 text-base font-semibold text-slate-700"
            />
          </div>
          <nav
            aria-label="Primary"
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
      <HealthFooter />
    </div>
  )
}
