/**
 * Account settings for the signed-in user (AUTH-5), opened from the
 * Settings button on their own profile page. Holds what used to be the
 * standalone profile page: read-only account details, profile visibility
 * (which gates the profile page for strangers, SHARE-1), the lecturing
 * language, and sign out.
 *
 * Owner-only. An admin editing someone else's account does it from the
 * admin user page, where every change is audited (ADMIN-5).
 */
import { useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'
import type { Locale, SafeUser } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import LanguageSelect from './LanguageSelect'
import Modal from './Modal'

export default function ProfileSettingsModal({
  onClose,
}: {
  onClose: () => void
}) {
  const { user, logout, updateUser } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  const onSignOut = async () => {
    await logout()
    navigate('/login')
  }

  const setLanguage = (language: Locale | null) => {
    dispatchAction<SafeUser>('user.setLanguage', { language })
      .then(updateUser)
      .catch(() => {
        // Quiet failure: the select reverts to the saved value
      })
  }

  const toggleVisibility = () => {
    const profileVisibility =
      user.profileVisibility === 'public' ? 'private' : 'public'
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
          Public profile — others can see your public and shared lectures
        </label>
      </div>

      <div className="mt-6 flex flex-col gap-1">
        <p className="text-sm font-medium text-slate-700">Lecture language</p>
        <p className="text-xs text-slate-500">
          Speech recognition and generated slides use this language. Projects
          and lectures can override it.
        </p>
        <LanguageSelect
          value={user.language}
          defaultLabel="your browser's language"
          onChange={setLanguage}
        />
      </div>

      <button
        onClick={() => void onSignOut()}
        className="mt-6 flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </Modal>
  )
}
