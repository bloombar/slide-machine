/**
 * Admin view of one lecture: its project and owner, its details
 * (id, visibility, slide count, dates), a link to the live slideshow at
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
import Modal from '../components/Modal'
import DetailRow from '../components/admin/DetailRow'
import { VisibilityBadge } from '../components/admin/LectureTable'
import SeedMaterialView from '../components/admin/SeedMaterialView'
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

export default function AdminDeckPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<AdminDeckDetailResponse | null>(null)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showSeed, setShowSeed] = useState(false)

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

  const { deck, project, owner, seed } = loaded
  const title = deck.title.trim() || 'Untitled lecture'
  // Any seed material at either level — the lecture's own or the project's.
  const seedUsed =
    Boolean(seed.lecture.notes) ||
    seed.lecture.assets.length > 0 ||
    Boolean(seed.project.notes) ||
    seed.project.assets.length > 0

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
          <DetailRow label="ID" value={deck.id} mono />
          <DetailRow label="Slides" value={String(deck.slideCount)} />
          <DetailRow label="Created" value={asDate(deck.createdAt)} />
          <DetailRow label="Updated" value={asDate(deck.updatedAt)} />
          <DetailRow label="Permalink" value={`/d/${deck.permalinkSlug}`} />
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-700">
              Seed material
            </h2>
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                seedUsed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-100 text-slate-600'
              }`}
            >
              {seedUsed ? 'Used' : 'None'}
            </span>
          </div>
          {seedUsed && (
            <button
              onClick={() => setShowSeed(true)}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View seed material
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {seedUsed
            ? 'Source material fed this lecture’s generation, including any inherited from the project.'
            : 'No source material fed this lecture’s generation.'}
        </p>
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

      {showSeed && (
        <Modal
          onClose={() => setShowSeed(false)}
          ariaLabel="Seed material"
          size="lg"
          className="max-h-[80vh] overflow-y-auto"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-800">
              Seed material
            </h2>
            <button
              onClick={() => setShowSeed(false)}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <SeedMaterialView seed={seed} projectTitle={projectTitle(project)} />
        </Modal>
      )}
    </div>
  )
}
