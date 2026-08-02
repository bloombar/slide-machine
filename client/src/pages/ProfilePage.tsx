/**
 * Profile page (SHARE-1): a user's display name and bio, then the lectures the
 * current viewer is allowed to see, grouped by project. Private profiles and
 * unknown users both read as "not found" — existence never leaks.
 *
 * Read-only. The owner and an allowlisted admin get a Settings link through to
 * `/app/settings`, which is where the name, the bio, and everything else about
 * the account are edited (AUTH-5). Editing used to happen here in place, which
 * meant two places to change a profile and only one of them had the rest of the
 * account's settings beside it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import type { ProfileResponse } from '@slide-machine/shared'
import { apiFetch } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { projectTitle } from '../lib/project'
import LectureRow from '../components/LectureRow'

/** The standard content container (mirrors AppShell's main wrapper —
 * PublicShell leaves containment to its pages for the deck viewer). */
function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      {children}
    </div>
  )
}

const headerButton =
  'flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const { status, user: viewer } = useAuth()
  const { t } = useTranslation()
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    // Wait for session restore so shared-with-me lectures resolve
    if (status === 'restoring' || !userId) return
    let cancelled = false
    apiFetch<ProfileResponse>(`/api/users/${userId}`)
      .then(res => {
        if (!cancelled) setProfile(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [status, userId])

  if (error) {
    return (
      <PageContainer>
        <p className="text-slate-600">{t('profile.notFound')}</p>
      </PageContainer>
    )
  }
  if (!profile) {
    return (
      <PageContainer>
        <p className="text-slate-500">{t('common.loading')}</p>
      </PageContainer>
    )
  }

  const isOwner = viewer?.id === profile.user.id
  // Your own settings live at the canonical route; an admin editing someone
  // else's names the account in the path (ADMIN-5).
  const settingsPath = isOwner ? '/app/settings' : `/app/settings/${userId}`

  return (
    <PageContainer>
      <div className="mb-2 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">{profile.user.displayName}</h1>
        {profile.canEdit && (
          <Link to={settingsPath} className={`shrink-0 ${headerButton}`}>
            <Settings className="h-4 w-4" aria-hidden />
            {t('common.settings')}
          </Link>
        )}
      </div>
      {profile.user.bio && (
        <p className="mb-6 whitespace-pre-line text-slate-600">
          {profile.user.bio}
        </p>
      )}

      {profile.projects.length === 0 ? (
        <p className="mt-6 text-slate-500">{t('profile.noLectures')}</p>
      ) : (
        profile.projects.map(({ project, decks }) => (
          <section key={project.id} className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-slate-700">
              {projectTitle(project)}
            </h2>
            <ul className="flex flex-col gap-2">
              {decks.map(deck => (
                <LectureRow key={deck.id} deck={deck} />
              ))}
            </ul>
          </section>
        ))
      )}
    </PageContainer>
  )
}
