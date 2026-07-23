/**
 * Admin view of one lecture: its project and owner, its details
 * (visibility, slide count, dates), a link to the live slideshow at
 * /d/:slug (always openable for admins), and a danger zone for
 * deleting the lecture — confirmed first and recorded in the admin
 * audit log server-side.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { deleteAdminDeck, fetchAdminDeck, logAdminDeckView } from '../api/admin'
import type { AdminDeckDetailResponse } from '../api/admin'
import { ApiError } from '../api/http'
import ConfirmDialog from '../components/ConfirmDialog'
import { VisibilityBadge } from '../components/admin/LectureTable'
import { projectTitle } from '../lib/project'

/** The action the admin has asked for but not yet confirmed. */
type PendingAction = { kind: 'delete' } | { kind: 'view-private' }

const asDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-36 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  )
}

export default function AdminDeckPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<AdminDeckDetailResponse | null>(null)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!deckId) return
    let cancelled = false
    fetchAdminDeck(deckId)
      .then(detail => {
        if (!cancelled) setLoaded(detail)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [deckId])

  /** Opens the live slideshow. Public lectures open straight away; opening
   * a private one is confirmed first and recorded in the audit log,
   * mirroring the always-on admin viewer bypass. */
  const openSlideshow = () => {
    if (!loaded) return
    if (loaded.deck.visibility === 'public') {
      navigate(`/d/${loaded.deck.permalinkSlug}`)
      return
    }
    setPending({ kind: 'view-private' })
  }

  /** Runs the confirmed action; both viewing a private lecture and
   * deleting one leave this page. */
  const runPending = async () => {
    if (!deckId || !loaded || !pending) return
    const action = pending
    setPending(null)
    setActionError(null)
    try {
      if (action.kind === 'view-private') {
        // Log the private-lecture access before handing over to the viewer
        await logAdminDeckView(deckId)
        navigate(`/d/${loaded.deck.permalinkSlug}`)
        return
      }
      await deleteAdminDeck(deckId)
      navigate(`/app/admin/projects/${loaded.project.id}`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.')
    }
  }

  /** Link back to the project's admin page (or the directory while the
   * project is unknown), shown in every page state. */
  const backLink = loaded ? (
    <Link
      to={`/app/admin/projects/${loaded.project.id}`}
      className="mb-3 inline-block text-sm text-slate-500 hover:underline"
    >
      &larr; {projectTitle(loaded.project)}
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
        <p className="text-red-600">Could not load this lecture.</p>
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

  const { deck, project, owner } = loaded
  const title = deck.title.trim() || 'Untitled lecture'

  /** Copy for the confirmation dialog of each pending action. */
  const confirmCopy = (action: PendingAction) =>
    action.kind === 'delete'
      ? {
          title: 'Delete this lecture?',
          message: `"${title}" and everything under it will be permanently deleted. This cannot be undone.`,
          confirmLabel: 'Delete lecture',
        }
      : {
          title: 'View this private lecture?',
          message: `"${title}" is a private lecture. Opening it as an admin is recorded in the audit log.`,
          confirmLabel: 'View slideshow',
        }

  return (
    <div>
      {backLink}
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <VisibilityBadge visibility={deck.visibility} />
      </div>
      <p className="mb-6 text-slate-500">
        In{' '}
        <Link
          to={`/app/admin/projects/${project.id}`}
          className="hover:underline"
        >
          {projectTitle(project)}
        </Link>{' '}
        · owned by{' '}
        <Link to={`/app/admin/users/${owner.id}`} className="hover:underline">
          {owner.displayName}
        </Link>{' '}
        ({owner.email})
      </p>

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {actionError}
        </p>
      )}

      <button
        onClick={openSlideshow}
        className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        View slideshow
      </button>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-700">Details</h2>
        <dl>
          <DetailRow label="Slides" value={String(deck.slideCount)} />
          <DetailRow label="Created" value={asDate(deck.createdAt)} />
          <DetailRow label="Updated" value={asDate(deck.updatedAt)} />
          <DetailRow label="Permalink" value={`/d/${deck.permalinkSlug}`} />
        </dl>
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
          onClick={() => setPending({ kind: 'delete' })}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Delete lecture
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
