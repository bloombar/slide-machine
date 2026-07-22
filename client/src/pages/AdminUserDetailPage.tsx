/**
 * Admin view of one user: account details, then their projects — each
 * expandable to its lectures, which link to the live deck viewer
 * (/d/:slug). Lectures owned by the user but living in someone else's
 * project are grouped under "Other lectures".
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Project, Visibility } from '@slide-machine/shared'
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

const asDate = (iso: string): string => new Date(iso).toLocaleDateString()

/** Newest of a project's own edit and any of its lectures' edits — so the
 * date reflects editing the project OR one of its lectures. ISO strings
 * sort chronologically, so a lexical max is a chronological one. */
const lastActivity = (
  project: Pick<Project, 'updatedAt'>,
  decks: AdminDeckSummary[],
): string =>
  [project.updatedAt, ...decks.map(d => d.updatedAt)].reduce((a, b) =>
    a > b ? a : b,
  )

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-36 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  )
}

/** Colour-coded pill for a lecture's effective visibility. */
function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const isPublic = visibility === 'public'
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
        isPublic
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-slate-200 bg-slate-100 text-slate-600'
      }`}
    >
      {isPublic ? 'Public' : 'Private'}
    </span>
  )
}

/** A project's lectures as a table: title, visibility, slide count, and
 * last-edited date. */
function LectureTable({ decks }: { decks: AdminDeckSummary[] }) {
  if (decks.length === 0) {
    return <p className="px-4 pb-3 text-sm text-slate-500">No lectures.</p>
  }
  return (
    <div className="px-4 pb-3">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              Lecture
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Visibility
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Slides
            </th>
            <th scope="col" className="py-1 font-medium">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {decks.map(deck => (
            <tr key={deck.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-3">
                <Link
                  to={`/d/${deck.permalinkSlug}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {deck.title.trim() || 'Untitled lecture'}
                </Link>
              </td>
              <td className="py-1.5 pr-3">
                <VisibilityBadge visibility={deck.visibility} />
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                {deck.slideCount}
              </td>
              <td className="py-1.5 text-slate-500">
                {asDate(deck.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
                      {projectDecks.length === 1 ? 'lecture' : 'lectures'} ·
                      updated {asDate(lastActivity(project, projectDecks))}
                    </span>
                  </summary>
                  <LectureTable decks={projectDecks} />
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
                <LectureTable decks={otherDecks} />
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
