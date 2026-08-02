/**
 * The active interface language and how to change it (TECH-12).
 *
 * Nothing is stored until a language is explicitly picked: absent a
 * choice the interface follows the browser, re-matched against the
 * supported locales on every visit. An explicit switch writes
 * localStorage, so the next visit's pre-auth paint is already right, and
 * — signed in — `User.locale`, which is what carries the preference to
 * another browser and what the AuthProvider reads back on the next
 * session restore. Choosing the default clears both again.
 *
 * This is a `.ts` file, not `.tsx`: it exports hooks rather than
 * components, which is what `react-refresh/only-export-components` wants.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale, SafeUser } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { useAuth } from '../auth/AuthContext'
import { storedLocale, subscribeStoredLocale } from './detect'
import { asLocale, changeLocale } from './index'

export interface LocaleState {
  /** The language the interface is showing in right now. */
  locale: Locale
  /** The explicit choice behind it; null = following the browser. */
  preference: Locale | null
  /** Records a choice, or null to follow the browser again. */
  setLocale: (locale: Locale | null) => void
}

export function useLocale(): LocaleState {
  // Subscribing through useTranslation is what re-renders consumers when
  // the language changes; the instance it hands back is the singleton.
  const { i18n } = useTranslation()
  const { status, user, updateUser } = useAuth()
  // Storage is read through a subscription because a switch can leave
  // the effective language untouched — picking the default when the
  // browser asks for the language already showing — and i18next has no
  // event for that.
  const remembered = useSyncExternalStore(subscribeStoredLocale, storedLocale)

  const setLocale = useCallback(
    (next: Locale | null) => {
      void changeLocale(next)
      if (status !== 'authenticated') return
      dispatchAction<SafeUser>('user.setLocale', { locale: next })
        .then(updateUser)
        .catch(() => {
          // Quiet failure: the switch still applies to this session, and
          // localStorage keeps it for the next one
        })
    },
    [status, updateUser],
  )

  return {
    locale: asLocale(i18n.language),
    // The account's choice outranks this browser's, the same order
    // AuthContext applies them in
    preference: user?.locale ?? remembered,
    setLocale,
  }
}
