/**
 * The active interface language and how to change it (TECH-12).
 *
 * A switch always writes localStorage, so the next visit's pre-auth
 * paint is already right. Signed in, it also writes `User.locale`, which
 * is what carries the preference to another browser and what the
 * AuthProvider reads back on the next session restore.
 *
 * This is a `.ts` file, not `.tsx`: it exports hooks rather than
 * components, which is what `react-refresh/only-export-components` wants.
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale, SafeUser } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { useAuth } from '../auth/AuthContext'
import { asLocale, changeLocale } from './index'

export interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export function useLocale(): LocaleState {
  // Subscribing through useTranslation is what re-renders consumers when
  // the language changes; the instance it hands back is the singleton.
  const { i18n } = useTranslation()
  const { status, updateUser } = useAuth()

  const setLocale = useCallback(
    (next: Locale) => {
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

  return { locale: asLocale(i18n.language), setLocale }
}
