/**
 * Admin view of one lecture: its project and owner, its details
 * (id, visibility, slide count, dates), a link to the live slideshow at
 * /d/:slug (always openable for admins), and a danger zone for
 * deleting the lecture — confirmed first and recorded in the admin
 * audit log server-side.
 *
 * A soft-deleted lecture is shown too, badged (ADMIN-6): the slideshow
 * still opens for an admin, exactly as a live one does, and the danger
 * zone becomes a Restore action. Opening it is audited by the read itself,
 * so it is confirmed here rather than logged here. Seed material the owner
 * removed is listed with its own badge.
 *
 * Settings are not edited here: "View slideshow" opens the lecture in
 * the viewer, where an admin edits its settings in the owner's own
 * settings modal (ADMIN-5, see DeckViewerPage).
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import CostPanel from '../components/admin/CostPanel'
import TelemetryPanel from '../components/admin/TelemetryPanel'
import {
  deleteAdminDeck,
  fetchAdminDeck,
  logAdminDeckView,
  restoreAdminDeck,
} from '../api/admin'
import type { AdminDeckDetailResponse } from '../api/admin'
import { ApiError } from '../api/http'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import DeletedBadge from '../components/admin/DeletedBadge'
import DetailRow from '../components/admin/DetailRow'
import { VisibilityBadge } from '../components/admin/LectureTable'
import SeedMaterialView from '../components/admin/SeedMaterialView'
import { projectTitle } from '../lib/project'

/** The action the admin has asked for but not yet confirmed. */
type PendingAction =
  | { kind: 'delete' }
  | { kind: 'restore' }
  | { kind: 'view-private' }
  | { kind: 'view-deleted' }

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
  // Bumped after a restore to refetch the lecture without its tombstone
  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
  }, [deckId, version])

  /** Opens the live slideshow. Public lectures open straight away; opening
   * a private or deleted one is confirmed first, mirroring the always-on
   * admin viewer bypass. A deleted lecture takes precedence in the copy —
   * it is the more surprising thing about what is being opened — and the
   * viewer's own read audits it, so nothing is logged from here. */
  const openSlideshow = () => {
    if (!loaded) return
    if (loaded.deck.deletedAt) {
      setPending({ kind: 'view-deleted' })
      return
    }
    if (loaded.deck.visibility === 'public') {
      navigate(`/d/${loaded.deck.permalinkSlug}`)
      return
    }
    setPending({ kind: 'view-private' })
  }

  /** Runs the confirmed action; both viewing a private lecture and
   * deleting one leave this page, while restoring stays and refetches. */
  const runPending = async () => {
    if (!deckId || !loaded || !pending) return
    const action = pending
    setPending(null)
    setNotice(null)
    setActionError(null)
    try {
      if (action.kind === 'view-private') {
        // Log the private-lecture access before handing over to the viewer
        await logAdminDeckView(deckId)
        navigate(`/d/${loaded.deck.permalinkSlug}`)
        return
      }
      if (action.kind === 'view-deleted') {
        // The viewer's own read logs this one (ADMIN-6), so just hand over
        navigate(`/d/${loaded.deck.permalinkSlug}`)
        return
      }
      if (action.kind === 'restore') {
        await restoreAdminDeck(deckId)
        setNotice('Lecture restored.')
        setVersion(v => v + 1)
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
  // A deleted lecture still opens in the viewer, read-only; its danger zone
  // becomes recovery (ADMIN-6).
  const deckDeleted = Boolean(deck.deletedAt)
  // Any seed material at either level — the lecture's own or the project's.
  const seedUsed =
    Boolean(seed.lecture.notes) ||
    seed.lecture.assets.length > 0 ||
    Boolean(seed.project.notes) ||
    seed.project.assets.length > 0

  /** Copy for the confirmation dialog of each pending action. The delete is
   * soft (P-10), so its copy promises recovery rather than finality. */
  const confirmCopy = (action: PendingAction) => {
    switch (action.kind) {
      case 'delete':
        return {
          title: 'Delete this lecture?',
          message: `"${title}" and everything under it will be hidden from everyone. You can restore it from this page until the retention sweep purges it.`,
          confirmLabel: 'Delete lecture',
        }
      case 'restore':
        return {
          title: 'Restore this lecture?',
          message: `"${title}" and everything deleted along with it will be visible to its owner again.`,
          confirmLabel: 'Restore lecture',
        }
      case 'view-private':
        return {
          title: 'View this private lecture?',
          message: `"${title}" is a private lecture. Opening it as an admin is recorded in the audit log.`,
          confirmLabel: 'View slideshow',
        }
      case 'view-deleted':
        return {
          title: 'View this deleted lecture?',
          message: `"${title}" is deleted, so nobody else can open it. You will see it as its owner last did, and opening it as an admin is recorded in the audit log.`,
          confirmLabel: 'View slideshow',
        }
    }
  }

  return (
    <div>
      {backLink}
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <VisibilityBadge visibility={deck.visibility} />
        <DeletedBadge deletedAt={deck.deletedAt} />
      </div>
      <p className="mb-6 text-slate-500">
        In{' '}
        <Link
          to={`/app/admin/projects/${project.id}`}
          className="hover:underline"
        >
          {projectTitle(project)}
        </Link>
        {project.deletedAt && <> (deleted)</>} · owned by{' '}
        <Link to={`/app/admin/users/${owner.id}`} className="hover:underline">
          {owner.displayName}
        </Link>{' '}
        ({owner.email}){owner.deletedAt && <> · account deleted</>}
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

      {deckDeleted && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          This lecture is deleted, so it is hidden from its owner and from every
          other viewer. You can still open the slideshow as it last stood; doing
          so is recorded in the{' '}
          <Link to="/app/admin/logs" className="underline">
            audit log
          </Link>
          . Restore it below until the retention sweep purges it, after which it
          is gone for good.
        </p>
      )}

      <button
        onClick={openSlideshow}
        className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        View slideshow
      </button>
      {/* A deleted lecture opens read-only: its settings modal saves through
          endpoints that refuse a tombstoned target, so the editing note only
          applies while it is live. */}
      {!deckDeleted && (
        <p className="mt-2 text-sm text-slate-500">
          Settings are edited in the lecture itself: open it and use the
          settings icon, as its owner would. Every change you make there is
          recorded in the{' '}
          <Link to="/app/admin/logs" className="underline">
            audit log
          </Link>
          .
        </p>
      )}

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

      {/* A deleted lecture offers recovery instead of moderation: the
          delete endpoint refuses a tombstoned target. */}
      {deckDeleted ? (
        <section className="mt-8 rounded-lg border border-emerald-200 p-4">
          <h2 className="mb-1 text-lg font-semibold text-emerald-800">
            Recovery
          </h2>
          <p className="mb-3 text-sm text-slate-600">
            Restoring brings back the lecture and everything deleted with it,
            and is recorded in the{' '}
            <Link to="/app/admin/logs" className="underline">
              audit log
            </Link>
            .
          </p>
          <button
            onClick={() => setPending({ kind: 'restore' })}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Restore lecture
          </button>
        </section>
      ) : (
        <section className="mt-8 rounded-lg border border-red-200 p-4">
          <h2 className="mb-1 text-lg font-semibold text-red-700">
            Danger zone
          </h2>
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
      )}

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
      {deckId && <TelemetryPanel deckId={deckId} />}
      {deckId && <CostPanel scope={{ kind: 'deck', id: deckId }} />}
    </div>
  )
}
