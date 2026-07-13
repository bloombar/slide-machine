/**
 * User profile (AUTH-5, minimal): account details, plan tier, profile
 * visibility (gates the public profile page, SHARE-1), and sign out.
 * Editing (display name, bio, avatar, locale) arrives later.
 */
import { Link, useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'
import type { Locale, SafeUser } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import LanguageSelect from '../components/LanguageSelect'

export default function ProfilePage() {
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
    <div>
      <h1 className="mb-8 text-2xl font-bold">Profile</h1>
      <section className="max-w-xl">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">{user.displayName}</p>
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
          <Link
            to={`/u/${user.id}`}
            className="text-sm text-indigo-600 hover:underline"
          >
            View your public profile
          </Link>
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
      </section>
    </div>
  )
}
