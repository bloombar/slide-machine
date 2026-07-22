/**
 * Admin view of one user: account details, then their projects — each
 * expandable to its lectures, which link to the live deck viewer
 * (/d/:slug). Lectures owned by the user but living in someone else's
 * project are grouped under "Other lectures".
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Project } from '@slide-machine/shared'
import {
  fetchAdminUser,
  fetchAdminUserDecks,
  fetchAdminUserProjects,
  type AdminDeckSummary,
  type AdminUserDetailResponse,
} from '../api/admin'
import { projectTitle } from '../lib/project'

interface Loaded {
  detail: AdminUserDetailResponse
  projects: Project[]
  decks: AdminDeckSummary[]
}

const joinedAt = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Link back to the admin users list, shown in every page state. */
function BackToUsers() {
  return (
    <Link
      to="/app/admin"
      className="mb-3 inline-block text-sm text-slate-500 hover:underline"
    >
      &larr; All users
    </Link>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-36 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  )
}

function LectureList({ decks }: { decks: AdminDeckSummary[] }) {
  if (decks.length === 0) {
    return <p className="px-4 pb-3 text-sm text-slate-500">No lectures.</p>
  }
  return (
    <ul className="flex flex-col gap-1 px-4 pb-3">
      {decks.map(deck => (
        <li key={deck.id} className="flex items-baseline gap-3 text-sm">
          <Link
            to={`/d/${deck.permalinkSlug}`}
            className="font-medium text-slate-900 hover:underline"
          >
            {deck.title.trim() || 'Untitled lecture'}
          </Link>
          <span className="text-xs text-slate-400">
            updated {new Date(deck.updatedAt).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      fetchAdminUser(userId),
      fetchAdminUserProjects(userId),
      fetchAdminUserDecks(userId),
    ])
      .then(([detail, { projects }, { decks }]) => {
        if (!cancelled) setLoaded({ detail, projects, decks })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (error) {
    return (
      <div>
        <BackToUsers />
        <p className="text-red-600">Could not load this user.</p>
      </div>
    )
  }
  if (!loaded) {
    return (
      <div>
        <BackToUsers />
        <p className="text-slate-500">Loading…</p>
      </div>
    )
  }

  const { detail, projects, decks } = loaded
  const { user } = detail
  const byProject = new Map<string, AdminDeckSummary[]>()
  for (const deck of decks) {
    const list = byProject.get(deck.projectId) ?? []
    list.push(deck)
    byProject.set(deck.projectId, list)
  }
  const ownProjectIds = new Set(projects.map(p => p.id))
  const otherDecks = decks.filter(d => !ownProjectIds.has(d.projectId))

  return (
    <div>
      <BackToUsers />
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">{user.displayName}</h1>
        <Link
          to={`/u/${user.id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          View public profile
        </Link>
      </div>
      <p className="mb-6 text-slate-500">{user.email}</p>

      <section className="rounded-lg border border-slate-200 p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-700">Details</h2>
        <dl>
          <DetailRow label="Joined" value={joinedAt(user.createdAt)} />
          <DetailRow label="Plan" value={user.planTier} />
          <DetailRow
            label="Email verified"
            value={user.emailVerified ? 'Yes' : 'No'}
          />
          <DetailRow label="Profile" value={user.profileVisibility} />
          <DetailRow label="Locale" value={user.locale} />
          {user.bio && <DetailRow label="Bio" value={user.bio} />}
          {user.billingProvider && (
            <DetailRow label="Billing" value={user.billingProvider} />
          )}
          <DetailRow label="Projects" value={String(detail.projectCount)} />
          <DetailRow label="Lectures" value={String(detail.deckCount)} />
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-slate-700">Projects</h2>
        {projects.length === 0 && otherDecks.length === 0 ? (
          <p className="text-slate-500">No projects.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map(project => {
              const projectDecks = byProject.get(project.id) ?? []
              return (
                <details
                  key={project.id}
                  className="rounded-lg border border-slate-200"
                >
                  <summary className="cursor-pointer px-4 py-3 font-medium text-slate-800 hover:bg-slate-50">
                    {projectTitle(project)}{' '}
                    <span className="text-sm font-normal text-slate-400">
                      {projectDecks.length}{' '}
                      {projectDecks.length === 1 ? 'lecture' : 'lectures'}
                    </span>
                  </summary>
                  <LectureList decks={projectDecks} />
                </details>
              )
            })}
            {otherDecks.length > 0 && (
              <details className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer px-4 py-3 font-medium text-slate-800 hover:bg-slate-50">
                  Other lectures{' '}
                  <span className="text-sm font-normal text-slate-400">
                    {otherDecks.length}
                  </span>
                </summary>
                <LectureList decks={otherDecks} />
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
