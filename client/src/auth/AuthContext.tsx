/**
 * Auth state for the whole app (SPEC AUTH-2). On mount, a silent refresh
 * restores the session from the httpOnly cookie; afterwards login,
 * register, and logout keep the state in sync.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { SafeUser } from '@slide-machine/shared'
import * as authApi from '../api/auth'
import { changeLocale } from '../i18n'
import { resolveInitialLocale } from '../i18n/detect'
import { refreshSession, setAccessToken } from './token'

export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous'

interface AuthState {
  user: SafeUser | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  register: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>
  logout: () => Promise<void>
  /** Replaces the cached user after a settings change elsewhere. */
  updateUser: (user: SafeUser) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('restoring')

  useEffect(() => {
    let cancelled = false
    refreshSession().then(session => {
      if (cancelled) return
      if (session) {
        setUser(session.user)
        setStatus('authenticated')
      } else {
        setStatus('anonymous')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The account's interface language outranks whatever was detected in
  // the browser (TECH-12), so applying it here covers session restore,
  // sign-in, and a switch made on another device alike.
  useEffect(() => {
    if (user) void changeLocale(user.locale)
  }, [user])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password })
    setUser(res.user)
    setStatus('authenticated')
  }, [])

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      // Carry the browser-detected locale onto the new account so the
      // first visit's guess persists instead of being re-made on the
      // next device (TECH-12).
      const res = await authApi.register({
        email,
        password,
        displayName,
        locale: resolveInitialLocale(),
      })
      setUser(res.user)
      setStatus('authenticated')
    },
    [],
  )

  const updateUser = useCallback((next: SafeUser) => setUser(next), [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setAccessToken(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, status, login, register, logout, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
