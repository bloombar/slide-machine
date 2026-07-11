/**
 * User profile (AUTH-5, minimal): account details, plan tier, and sign
 * out. Editing (display name, bio, avatar, locale) arrives later.
 */
import { useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  const onSignOut = async () => {
    await logout()
    navigate('/login')
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
