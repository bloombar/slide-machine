/**
 * Account settings for one user (AUTH-5), opened from the Settings button
 * on their profile page: read-only account details, profile visibility
 * (which gates the profile page for strangers, SHARE-1), the lecturing
 * language, and sign out.
 *
 * An allowlisted admin opening someone else's profile edits that account
 * here too (ADMIN-5, `adminUserId`) — the same button, the same controls,
 * saving as you go — through the audited admin endpoint, with a banner up
 * for as long as the settings are open and an audit entry per change.
 * Two fields differ by design: sign out ends the *admin's* own session, so
 * it stays with the owner, and the interface locale is admin-only until
 * the in-app language switcher lands (TECH-12).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'
import {
  LOCALES,
  LOCALE_LABELS,
  type AdminUserSettingsPatch,
  type Locale,
  type ProfileVisibility,
  type SafeUser,
} from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { fetchAdminUser, updateAdminUserSettings } from '../api/admin'
import { ApiError } from '../api/http'
import AdminEditNotice from './AdminEditNotice'
import LanguageSelect from './LanguageSelect'
import Modal from './Modal'

/** One settings change, as the account itself holds it: an absent
 * `language` means "unchanged", an explicit `undefined` one means
 * "inherit the browser default". */
type AccountChange = Partial<
  Pick<SafeUser, 'profileVisibility' | 'locale' | 'language'>
>

/** The same change as the admin endpoint takes it. `JSON.stringify` drops
 * `undefined`, so clearing the language has to travel as an explicit
 * `null` — but only when the change touches the language at all. */
const wirePatch = (change: AccountChange): AdminUserSettingsPatch => ({
  ...change,
  ...('language' in change ? { language: change.language ?? null } : {}),
})

interface Props {
  /** The account being edited when an admin opened these settings from
   * someone else's profile (ADMIN-5). Absent means the signed-in user's
   * own account, read from the auth context. */
  adminUserId?: string
  onClose: () => void
}

export default function ProfileSettingsModal({ adminUserId, onClose }: Props) {
  const { user: viewer, logout, updateUser } = useAuth()
  const navigate = useNavigate()
  // The account an admin is editing. It holds the saved values too, so
  // every control shows what actually landed.
  const [target, setTarget] = useState<SafeUser | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!adminUserId) return
    let cancelled = false
    fetchAdminUser(adminUserId)
      .then(({ user }) => {
        if (!cancelled) setTarget(user)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [adminUserId])

  const user = adminUserId ? target : viewer
  if (!adminUserId && !user) return null

  const onSignOut = async () => {
    await logout()
    navigate('/login')
  }

  /** Saves one changed field of the admin's target account and folds it
   * in. Unlike the owner's quiet failures, a refusal here is reported —
   * the account is not the admin's, so a silent revert would mislead. */
  const saveAsAdmin = async (change: AccountChange) => {
    if (!adminUserId) return
    setSaveError(null)
    try {
      await updateAdminUserSettings(adminUserId, wirePatch(change))
      setTarget(current => (current ? { ...current, ...change } : current))
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : 'Could not save these settings.',
      )
    }
  }

  const setLanguage = (language: Locale | null) => {
    if (adminUserId) {
      void saveAsAdmin({ language: language ?? undefined })
      return
    }
    dispatchAction<SafeUser>('user.setLanguage', { language })
      .then(updateUser)
      .catch(() => {
        // Quiet failure: the select reverts to the saved value
      })
  }

  const setLocale = (locale: Locale) => void saveAsAdmin({ locale })

  const toggleVisibility = () => {
    const profileVisibility: ProfileVisibility =
      user?.profileVisibility === 'public' ? 'private' : 'public'
    if (adminUserId) {
      void saveAsAdmin({ profileVisibility })
      return
    }
    dispatchAction<SafeUser>('user.setProfileVisibility', {
      profileVisibility,
    })
      .then(updateUser)
      .catch(() => {
        // Quiet failure: the toggle reverts to the saved value
      })
  }

  return (
    <Modal ariaLabelledBy="profile-settings-title" size="md" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <h2 id="profile-settings-title" className="text-lg font-bold">
          Settings
        </h2>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          Close settings
        </button>
      </div>

      {adminUserId && (
        <div className="mt-4">
          <AdminEditNotice entity="account" />
        </div>
      )}

      {loadFailed && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          Could not load this account.
        </p>
      )}
      {!user && !loadFailed && (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      )}

      {user && (
        <>
          {saveError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {saveError}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-1">
            <p className="text-sm text-slate-600">{user.email}</p>
            <p className="text-sm text-slate-600">
              Plan:{' '}
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                {user.planTier}
              </span>
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={user.profileVisibility === 'public'}
                onChange={toggleVisibility}
                aria-label="Public profile"
              />
              Public profile — others can see {adminUserId ? 'their' : 'your'}{' '}
              public and shared lectures
            </label>
          </div>

          {adminUserId && (
            <div className="mt-6 flex flex-col gap-1">
              <label
                htmlFor="account-locale"
                className="text-sm font-medium text-slate-700"
              >
                Interface locale
              </label>
              <p className="text-xs text-slate-500">
                The language the app itself is shown in.
              </p>
              <select
                id="account-locale"
                value={user.locale}
                onChange={e => setLocale(e.target.value as Locale)}
                className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                {LOCALES.map(locale => (
                  <option key={locale} value={locale}>
                    {LOCALE_LABELS[locale]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-1">
            <p className="text-sm font-medium text-slate-700">
              Lecture language
            </p>
            <p className="text-xs text-slate-500">
              Speech recognition and generated slides use this language.
              Projects and lectures can override it.
            </p>
            <LanguageSelect
              value={user.language}
              defaultLabel={
                adminUserId
                  ? 'their browser language'
                  : "your browser's language"
              }
              onChange={setLanguage}
            />
          </div>

          {!adminUserId && (
            <button
              onClick={() => void onSignOut()}
              className="mt-6 flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          )}
        </>
      )}
    </Modal>
  )
}
