/**
 * Public profile (SHARE-1 / AUTH-5): a user's lectures the current
 * viewer is allowed to see, grouped by project. Private profiles and
 * unknown users both read as "not found" — existence never leaks.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import type { ProfileResponse } from '@slide-machine/shared'
import { apiFetch } from '../api/http'
import { useAuth } from '../auth/AuthContext'
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

export default function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const { status } = useAuth()
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
        <p className="text-slate-600">
          This profile does not exist or is private.
        </p>
      </PageContainer>
    )
  }
  if (!profile) {
    return (
      <PageContainer>
        <p className="text-slate-500">Loading…</p>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <h1 className="mb-2 text-2xl font-bold">{profile.user.displayName}</h1>
      {profile.user.bio && (
        <p className="mb-6 text-slate-600">{profile.user.bio}</p>
      )}
      {profile.projects.length === 0 ? (
        <p className="mt-6 text-slate-500">No lectures to show.</p>
      ) : (
        profile.projects.map(({ project, decks }) => (
          <section key={project.id} className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-slate-700">
              {project.title}
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
