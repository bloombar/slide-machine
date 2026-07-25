/**
 * Admin view of one project: its owner, its details (id, dates, lecture
 * count), its lectures (each linking to its own admin lecture page), and
 * the project-level moderation actions (delete a lecture, delete the
 * whole project). Every lecture, private or not, is listed; opening one
 * in the viewer is always allowed for admins.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  deleteAdminDeck,
  deleteAdminProject,
  fetchAdminProject,
  logAdminProjectView,
  type AdminDeckSummary,
  type AdminProjectDetailResponse,
} from '../api/admin'
import { ApiError } from '../api/http'
import ConfirmDialog from '../components/ConfirmDialog'
import DetailRow from '../components/admin/DetailRow'
import LectureTable, { VisibilityBadge } from '../components/admin/LectureTable'
import { formatAdminDate } from '../lib/date'
import { projectTitle } from '../lib/project'

/** The action the admin has asked for but not yet confirmed. */
type PendingAction =
  | { kind: 'delete-project' }
  | { kind: 'delete-deck'; deck: AdminDeckSummary }
  | { kind: 'view-private' }

export default function AdminProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<AdminProjectDetailResponse | null>(null)
  const [error, setError] = useState(false)
  // Bumped after a mutation to refetch the lecture list
  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetchAdminProject(projectId)
      .then(detail => {
        if (!cancelled) setLoaded(detail)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, version])

  /** Opens the project's real (owner-facing) page. Public projects open
   * straight away; opening a private one is confirmed first and recorded
   * in the audit log, mirroring the always-on admin viewer bypass. */
  const openProject = () => {
    if (!loaded) return
    if (loaded.project.visibility === 'public') {
      navigate(`/app/projects/${loaded.project.id}`)
      return
    }
    setPending({ kind: 'view-private' })
  }

  /** Runs the confirmed action; deleting the project or viewing it
   * leaves this page. */
  const runPending = async () => {
    if (!pending || !projectId || !loaded) return
    const action = pending
    setPending(null)
    setNotice(null)
    setActionError(null)
    try {
      if (action.kind === 'view-private') {
        // Log the private-project access before handing over to it
        await logAdminProjectView(projectId)
        navigate(`/app/projects/${projectId}`)
        return
      }
      if (action.kind === 'delete-project') {
        await deleteAdminProject(projectId)
        navigate(`/app/admin/users/${loaded.owner.id}`)
        return
      }
      await deleteAdminDeck(action.deck.id)
      setNotice('Lecture deleted.')
      setVersion(v => v + 1)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.')
    }
  }

  /** Link back to the owner's admin page (or the directory while the
   * owner is unknown), shown in every page state. */
  const backLink = loaded ? (
    <Link
      to={`/app/admin/users/${loaded.owner.id}`}
      className="mb-3 inline-block text-sm text-slate-500 hover:underline"
    >
      &larr; {loaded.owner.displayName}
    </Link>
  ) : (
    <Link
      to="/app/admin"
      className="mb-3 inline-block text-sm text-slate-500 hover:underline"
    >
      &larr; All users
    </Link>
  )

  if (error) {
    return (
      <div>
        {backLink}
        <p className="text-red-600">Could not load this project.</p>
      </div>
    )
  }
  if (!loaded) {
    return (
      <div>
        {backLink}
        <p className="text-slate-500">Loading…</p>
      </div>
    )
  }

  const { project, owner, decks } = loaded

  /** Copy for the confirmation dialog of each pending action. */
  const confirmCopy = (action: PendingAction) => {
    switch (action.kind) {
      case 'delete-project':
        return {
          title: 'Delete this project?',
          message: `"${projectTitle(project)}" and every lecture and file in it will be permanently deleted. This cannot be undone.`,
          confirmLabel: 'Delete project',
        }
      case 'delete-deck':
        return {
          title: 'Delete this lecture?',
          message: `"${action.deck.title.trim() || 'Untitled lecture'}" and everything under it will be permanently deleted. This cannot be undone.`,
          confirmLabel: 'Delete lecture',
        }
      case 'view-private':
        return {
          title: 'View this private project?',
          message: `"${projectTitle(project)}" is a private project. Opening it as an admin is recorded in the audit log.`,
          confirmLabel: 'View project',
        }
    }
  }

  return (
    <div>
      {backLink}
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{projectTitle(project)}</h1>
        <VisibilityBadge visibility={project.visibility} />
      </div>
      <p className="mb-6 text-slate-500">
        Owned by{' '}
        <Link to={`/app/admin/users/${owner.id}`} className="hover:underline">
          {owner.displayName}
        </Link>{' '}
        ({owner.email})
      </p>

      {notice && (
        <p role="status" className="mb-4 text-sm text-green-700">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {actionError}
        </p>
      )}

      <button
        onClick={openProject}
        className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        View project
      </button>

      <section className="mt-6 mb-6 rounded-lg border border-slate-200 p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-700">Details</h2>
        <dl>
          <DetailRow label="ID" value={project.id} mono />
          <DetailRow
            label="Created"
            value={formatAdminDate(project.createdAt)}
          />
          <DetailRow
            label="Updated"
            value={formatAdminDate(project.updatedAt)}
          />
          <DetailRow label="Lectures" value={String(decks.length)} />
        </dl>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-700">Lectures</h2>
        </div>
        <div className="rounded-lg border border-slate-200 pt-3">
          <LectureTable
            decks={decks}
            onDelete={deck => setPending({ kind: 'delete-deck', deck })}
          />
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-red-200 p-4">
        <h2 className="mb-1 text-lg font-semibold text-red-700">Danger zone</h2>
        <p className="mb-3 text-sm text-slate-600">
          Every action here is recorded in the{' '}
          <Link to="/app/admin/logs" className="underline">
            audit log
          </Link>
          .
        </p>
        <button
          onClick={() => setPending({ kind: 'delete-project' })}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Delete project
        </button>
      </section>

      {pending && (
        <ConfirmDialog
          {...confirmCopy(pending)}
          onConfirm={() => void runPending()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
