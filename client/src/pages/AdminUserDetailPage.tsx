/**
 * Admin view of one user: their account details, then their projects, each
 * linking to its own admin project page (/app/admin/projects/:id).
 * Lectures owned by the user but living in someone else's project are
 * grouped under "Other lectures", each linking to its own admin
 * lecture page. Moderation lives here too: per-project and per-lecture
 * delete buttons plus a danger zone (reset password, ban/unban email,
 * delete account) — every action confirms first and is recorded in the admin
 * audit log server-side. Every lecture, private or not, is listed;
 * admins can always open any lecture in the viewer.
 *
 * Soft-deleted content is listed too, badged and muted (ADMIN-6): opening
 * a deleted account is itself audited, its row actions become Restore, and
 * the moderation actions are withdrawn — a tombstoned record is recovered,
 * not moderated again. Restores work until the retention sweep purges the
 * tombstone (P-11).
 *
 * The details are read-only: like a project's or a lecture's, account
 * settings are edited in the product itself, from the Settings button on
 * the user's profile page, in the owner's own modal (ADMIN-5, see
 * ProfilePage). This page links there.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import CostPanel from '../components/admin/CostPanel'
import { LOCALE_LABELS, type Locale } from '@slide-machine/shared'
import {
  banAdminUserEmail,
  deleteAdminDeck,
  deleteAdminProject,
  deleteAdminUser,
  fetchAdminUser,
  fetchAdminUserDecks,
  fetchAdminUserProjects,
  resetAdminUserPassword,
  restoreAdminDeck,
  restoreAdminProject,
  restoreAdminUser,
  unbanAdminUserEmail,
  type AdminDeckSummary,
  type AdminUserDetailResponse,
  type AdminUserProject,
} from '../api/admin'
import { ApiError } from '../api/http'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import DeletedBadge, {
  deletedTextClass,
} from '../components/admin/DeletedBadge'
import DetailRow from '../components/admin/DetailRow'
import LectureTable from '../components/admin/LectureTable'
import { generatePassword } from '../lib/password'
import { projectTitle } from '../lib/project'

const localeLabel = (value: unknown): string =>
  value ? LOCALE_LABELS[value as Locale] : 'Default (browser setting)'

interface Loaded {
  detail: AdminUserDetailResponse
  projects: AdminUserProject[]
  decks: AdminDeckSummary[]
}

/** The moderation the admin has asked for but not yet confirmed. */
type PendingAction =
  | { kind: 'delete-user' }
  | { kind: 'restore-user' }
  | { kind: 'ban' }
  | { kind: 'unban' }
  | { kind: 'delete-project'; project: AdminUserProject }
  | { kind: 'restore-project'; project: AdminUserProject }
  | { kind: 'delete-deck'; deck: AdminDeckSummary }
  | { kind: 'restore-deck'; deck: AdminDeckSummary }

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

const asDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * The Plan row: the tier the account may spend against, and — when a
 * complimentary grant is what put it there (ADMIN-9) — what it is paying for
 * underneath and when it goes back to it. A lapsed grant is named as history
 * rather than dropped: knowing an account *was* comped until last month is
 * what explains the usage on it.
 *
 * Granting one is not done here. Like every other account setting, it is done
 * in the product view this page links to (ADMIN-5) — the Plan tab of the
 * user's settings page.
 */
const planValue = (detail: AdminUserDetailResponse): string => {
  const { user, billingTier, planGrant } = detail
  if (!planGrant) return user.planTier
  const until = `until ${asDate(planGrant.expiresAt)}`
  return planGrant.inEffect
    ? `${user.planTier} — complimentary ${until}, then ${billingTier}`
    : `${user.planTier} (complimentary ${planGrant.tier} ended ${asDate(planGrant.expiresAt)})`
}

/** Newest of a project's own edit and any of its lectures' edits — so the
 * date reflects editing the project OR one of its lectures. ISO strings
 * sort chronologically, so a lexical max is a chronological one. */
const lastActivity = (
  project: Pick<AdminUserProject, 'updatedAt'>,
  decks: AdminDeckSummary[],
): string =>
  [project.updatedAt, ...decks.map(d => d.updatedAt)].reduce((a, b) =>
    a > b ? a : b,
  )

const dangerMenuButton =
  'rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50'

/** Dialog for setting a user's new password; submits on Enter, reports
 * inline errors, and reminds the admin every session gets signed out. */
function ResetPasswordDialog({
  email,
  onSubmit,
  onCancel,
}: {
  email: string
  onSubmit: (password: string) => Promise<void>
  onCancel: () => void
}) {
  // Prefill with a strong random password so the admin can hand one out
  // immediately; they can edit it or regenerate before submitting.
  const [password, setPassword] = useState(() => generatePassword())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set password')
      setSaving(false)
    }
  }

  return (
    <Modal
      ariaLabelledBy="admin-reset-password-title"
      size="sm"
      onClose={onCancel}
      initialFocusRef={inputRef}
    >
      <form onSubmit={submit}>
        <h3 id="admin-reset-password-title" className="text-lg font-bold">
          Reset password
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Set a new password for {email}. They will be signed out everywhere.
        </p>

        <label
          htmlFor="admin-new-password"
          className="mt-4 block text-sm font-medium text-slate-700"
        >
          New password
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="admin-new-password"
            ref={inputRef}
            type="text"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
          />
          <button
            type="button"
            onClick={() => {
              setError(null)
              setPassword(generatePassword())
            }}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Regenerate
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          A strong password was generated. Copy it before saving.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            Set password
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** The ConfirmDialog copy for each moderation action. Deletes are soft
 * (P-10), so their copy promises recovery rather than finality. */
const confirmCopy = (
  pending: PendingAction,
  email: string,
): { title: string; message: string; confirmLabel: string } => {
  switch (pending.kind) {
    case 'delete-user':
      return {
        title: 'Delete this user?',
        message: `${email} and all of their projects, lectures, and files will be hidden from everyone and the account signed out. You can restore it from this page until the retention sweep purges it.`,
        confirmLabel: 'Delete user',
      }
    case 'restore-user':
      return {
        title: 'Restore this user?',
        message: `${email} and everything deleted along with the account will be visible to them again.`,
        confirmLabel: 'Restore user',
      }
    case 'restore-project':
      return {
        title: 'Restore this project?',
        message: `"${projectTitle(pending.project)}" and everything deleted along with it will be visible to its owner again.`,
        confirmLabel: 'Restore project',
      }
    case 'restore-deck':
      return {
        title: 'Restore this lecture?',
        message: `"${pending.deck.title.trim() || 'Untitled lecture'}" and everything deleted along with it will be visible to its owner again.`,
        confirmLabel: 'Restore lecture',
      }
    case 'ban':
      return {
        title: 'Ban this email?',
        message: `${email} will be signed out everywhere and can no longer sign in or register. Their content stays until deleted separately.`,
        confirmLabel: 'Ban email',
      }
    case 'unban':
      return {
        title: 'Unban this email?',
        message: `${email} will be able to sign in and register again.`,
        confirmLabel: 'Unban email',
      }
    case 'delete-project':
      return {
        title: 'Delete this project?',
        message: `"${projectTitle(pending.project)}" and every lecture and file in it will be hidden from everyone. You can restore it from this page until the retention sweep purges it.`,
        confirmLabel: 'Delete project',
      }
    case 'delete-deck':
      return {
        title: 'Delete this lecture?',
        message: `"${pending.deck.title.trim() || 'Untitled lecture'}" and everything under it will be hidden from everyone. You can restore it from this page until the retention sweep purges it.`,
        confirmLabel: 'Delete lecture',
      }
  }
}

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState(false)
  // Bumped after a mutation to refetch counts, projects, and lectures
  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
  }, [userId, version])

  /** Runs the confirmed action; deleting the user leaves the page. */
  const runPending = async () => {
    if (!pending || !userId) return
    const action = pending
    setPending(null)
    setNotice(null)
    setActionError(null)
    try {
      switch (action.kind) {
        case 'delete-user':
          await deleteAdminUser(userId)
          navigate('/app/admin')
          return
        case 'restore-user':
          await restoreAdminUser(userId)
          setNotice('Account restored.')
          break
        case 'ban':
          await banAdminUserEmail(userId)
          setNotice('Email banned; all sessions signed out.')
          break
        case 'unban':
          await unbanAdminUserEmail(userId)
          setNotice('Email unbanned.')
          break
        case 'delete-project':
          await deleteAdminProject(action.project.id)
          setNotice('Project deleted; you can restore it from this page.')
          break
        case 'restore-project':
          await restoreAdminProject(action.project.id)
          setNotice('Project restored.')
          break
        case 'delete-deck':
          await deleteAdminDeck(action.deck.id)
          setNotice('Lecture deleted; you can restore it from this page.')
          break
        case 'restore-deck':
          await restoreAdminDeck(action.deck.id)
          setNotice('Lecture restored.')
          break
      }
      setVersion(v => v + 1)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.')
    }
  }

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
  // A deleted account has no product surfaces left to open and cannot be
  // moderated again — it is restored instead (ADMIN-6).
  const userDeleted = Boolean(detail.deletedAt)
  const byProject = new Map<string, AdminDeckSummary[]>()
  for (const deck of decks) {
    const list = byProject.get(deck.projectId) ?? []
    list.push(deck)
    byProject.set(deck.projectId, list)
  }
  const ownProjectIds = new Set(projects.map(p => p.id))
  const otherDecks = decks.filter(d => !ownProjectIds.has(d.projectId))
  const deleteDeck = (deck: AdminDeckSummary) =>
    setPending({ kind: 'delete-deck', deck })
  const restoreDeck = (deck: AdminDeckSummary) =>
    setPending({ kind: 'restore-deck', deck })

  return (
    <div>
      <BackToUsers />
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">{user.displayName}</h1>
        {!userDeleted && (
          <Link
            to={`/u/${user.id}`}
            className="text-sm text-slate-500 hover:underline"
          >
            View public profile
          </Link>
        )}
      </div>
      <p className="mb-6 text-slate-500">
        {user.email}
        {detail.banned && (
          <span className="ml-2 inline-block rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            Banned
          </span>
        )}{' '}
        <DeletedBadge deletedAt={detail.deletedAt} />
      </p>

      {userDeleted && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          This account is deleted, so nothing here is visible to its owner or
          anyone else. Opening it is recorded in the{' '}
          <Link to="/app/admin/logs" className="underline">
            audit log
          </Link>
          . Restore it below until the retention sweep purges it, after which it
          is gone for good.
        </p>
      )}

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

      {!userDeleted && (
        <p className="mb-4 text-sm text-slate-500">
          Settings are edited on the user&apos;s{' '}
          <Link to={`/app/settings/${user.id}`} className="underline">
            Account Settings
          </Link>{' '}
          page. Its Plan tab is also where an account is given a complimentary
          plan. Every change you make there is recorded in the{' '}
          <Link to="/app/admin/logs" className="underline">
            audit log
          </Link>
          .
        </p>
      )}

      <section className="rounded-lg border border-slate-200 p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-700">Details</h2>
        <dl>
          <DetailRow label="Joined" value={joinedAt(user.createdAt)} />
          <DetailRow label="Plan" value={planValue(detail)} />
          <DetailRow
            label="Email verified"
            value={user.emailVerified ? 'Yes' : 'No'}
          />
          <DetailRow label="Display name" value={user.displayName} />
          <DetailRow label="Bio" value={user.bio || 'Empty'} />
          <DetailRow
            label="Profile visibility"
            value={user.profileVisibility}
          />
          <DetailRow
            label="Interface locale"
            value={localeLabel(user.locale)}
          />
          <DetailRow
            label="Lecturing language"
            value={localeLabel(user.language)}
          />
          {user.billingProvider && (
            <DetailRow label="Billing" value={user.billingProvider} />
          )}
          <DetailRow label="Projects" value={String(detail.projectCount)} />
          <DetailRow label="Lectures" value={String(detail.deckCount)} />
        </dl>
      </section>

      {userId && <CostPanel scope={{ kind: 'user', id: userId }} />}

      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-700">Projects</h2>
        </div>
        {projects.length === 0 && otherDecks.length === 0 ? (
          <p className="text-slate-500">No projects.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map(project => {
              const projectDecks = byProject.get(project.id) ?? []
              return (
                <div
                  key={project.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/app/admin/projects/${project.id}`}
                      className={`font-medium hover:underline ${
                        project.deletedAt ? deletedTextClass : 'text-slate-800'
                      }`}
                    >
                      {projectTitle(project)}{' '}
                      <span className="text-sm font-normal text-slate-400">
                        {projectDecks.length}{' '}
                        {projectDecks.length === 1 ? 'lecture' : 'lectures'} ·
                        updated {asDate(lastActivity(project, projectDecks))}
                      </span>
                    </Link>{' '}
                    <DeletedBadge deletedAt={project.deletedAt} />
                  </div>
                  {project.deletedAt ? (
                    <button
                      onClick={() =>
                        setPending({ kind: 'restore-project', project })
                      }
                      aria-label={`Restore project ${projectTitle(project)}`}
                      className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setPending({ kind: 'delete-project', project })
                      }
                      aria-label={`Delete project ${projectTitle(project)}`}
                      className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
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
                <LectureTable
                  decks={otherDecks}
                  onDelete={deleteDeck}
                  onRestore={restoreDeck}
                />
              </details>
            )}
          </div>
        )}
      </section>

      {/* A deleted account offers recovery instead of moderation: every
          moderation endpoint refuses a tombstoned target. */}
      {userDeleted ? (
        <section className="mt-8 rounded-lg border border-emerald-200 p-4">
          <h2 className="mb-1 text-lg font-semibold text-emerald-800">
            Recovery
          </h2>
          <p className="mb-3 text-sm text-slate-600">
            Restoring brings back the account and everything deleted with it.
            Moderation is unavailable while the account is deleted; it is
            recorded in the{' '}
            <Link to="/app/admin/logs" className="underline">
              audit log
            </Link>
            .
          </p>
          <button
            onClick={() => setPending({ kind: 'restore-user' })}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Restore user
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPasswordOpen(true)}
              className={dangerMenuButton}
            >
              Reset password
            </button>
            <button
              onClick={() =>
                setPending({ kind: detail.banned ? 'unban' : 'ban' })
              }
              className={dangerMenuButton}
            >
              {detail.banned ? 'Unban email' : 'Ban email'}
            </button>
            <button
              onClick={() => setPending({ kind: 'delete-user' })}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
            >
              Delete user
            </button>
          </div>
        </section>
      )}

      {pending && (
        <ConfirmDialog
          {...confirmCopy(pending, user.email)}
          onConfirm={() => void runPending()}
          onCancel={() => setPending(null)}
        />
      )}
      {passwordOpen && (
        <ResetPasswordDialog
          email={user.email}
          onCancel={() => setPasswordOpen(false)}
          onSubmit={async password => {
            if (!userId) return
            await resetAdminUserPassword(userId, password)
            setPasswordOpen(false)
            setNotice('Password updated; all sessions signed out.')
          }}
        />
      )}
    </div>
  )
}
