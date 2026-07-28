/**
 * Admin view of one user: account details, then their projects — each
 * linking to its own admin project page (/app/admin/projects/:id).
 * Lectures owned by the user but living in someone else's project are
 * grouped under "Other lectures", each linking to its own admin
 * lecture page. Moderation lives here too: per-project and per-lecture
 * delete buttons plus a danger zone (reset password, ban/unban email,
 * delete account) — every action confirms first and is recorded in the admin
 * audit log server-side. Every lecture, private or not, is listed;
 * admins can always open any lecture in the viewer.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  LOCALES,
  LOCALE_LABELS,
  type AdminUserSettingsPatch,
  type Locale,
  type ProfileVisibility,
  type Project,
} from '@slide-machine/shared'
import {
  banAdminUserEmail,
  deleteAdminDeck,
  deleteAdminProject,
  deleteAdminUser,
  fetchAdminUser,
  fetchAdminUserDecks,
  fetchAdminUserProjects,
  resetAdminUserPassword,
  unbanAdminUserEmail,
  updateAdminUserSettings,
  type AdminDeckSummary,
  type AdminUserDetailResponse,
} from '../api/admin'
import { ApiError } from '../api/http'
import ConfirmDialog from '../components/ConfirmDialog'
import LanguageSelect from '../components/LanguageSelect'
import Modal from '../components/Modal'
import DetailRow from '../components/admin/DetailRow'
import LectureTable from '../components/admin/LectureTable'
import SettingsPanel from '../components/admin/SettingsPanel'
import type { FieldLabels } from '../lib/admin-changes'
import { generatePassword } from '../lib/password'
import { projectTitle } from '../lib/project'

/** The account's admin-editable profile fields, as edited on this page.
 * An absent language means "inherit the browser's". */
interface UserSettingsDraft {
  displayName: string
  bio: string
  profileVisibility: ProfileVisibility
  locale: Locale
  language?: Locale
}

const localeLabel = (value: unknown): string =>
  value ? LOCALE_LABELS[value as Locale] : 'Default (browser setting)'

const USER_FIELDS: FieldLabels<UserSettingsDraft> = {
  displayName: 'Display name',
  bio: { label: 'Bio', format: value => (value ? String(value) : 'Empty') },
  profileVisibility: 'Profile visibility',
  locale: { label: 'Interface locale', format: localeLabel },
  language: { label: 'Lecturing language', format: localeLabel },
}

const fieldLabelClass = 'block text-sm font-medium text-slate-700'
const textInputClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm'

interface Loaded {
  detail: AdminUserDetailResponse
  projects: Project[]
  decks: AdminDeckSummary[]
}

/** The moderation the admin has asked for but not yet confirmed. */
type PendingAction =
  | { kind: 'delete-user' }
  | { kind: 'ban' }
  | { kind: 'unban' }
  | { kind: 'delete-project'; project: Project }
  | { kind: 'delete-deck'; deck: AdminDeckSummary }

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

/** The ConfirmDialog copy for each moderation action. */
const confirmCopy = (
  pending: PendingAction,
  email: string,
): { title: string; message: string; confirmLabel: string } => {
  switch (pending.kind) {
    case 'delete-user':
      return {
        title: 'Delete this user?',
        message: `${email} and all of their projects, lectures, and files will be permanently deleted. This cannot be undone.`,
        confirmLabel: 'Delete user',
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
        message: `"${projectTitle(pending.project)}" and every lecture and file in it will be permanently deleted. This cannot be undone.`,
        confirmLabel: 'Delete project',
      }
    case 'delete-deck':
      return {
        title: 'Delete this lecture?',
        message: `"${pending.deck.title.trim() || 'Untitled lecture'}" and everything under it will be permanently deleted. This cannot be undone.`,
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
          setNotice('Project deleted.')
          break
        case 'delete-deck':
          await deleteAdminDeck(action.deck.id)
          setNotice('Lecture deleted.')
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
  const settings: UserSettingsDraft = {
    displayName: user.displayName,
    bio: user.bio ?? '',
    profileVisibility: user.profileVisibility,
    locale: user.locale,
    language: user.language,
  }

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
      <p className="mb-6 text-slate-500">
        {user.email}
        {detail.banned && (
          <span className="ml-2 inline-block rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            Banned
          </span>
        )}
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

      <SettingsPanel
        value={settings}
        labels={USER_FIELDS}
        confirmTitle="Save these profile settings?"
        description="Editing another account's profile. Plan tier, email, and password are set elsewhere."
        onSave={async patch => {
          if (!userId) return
          // The panel's patch type allows null on every field; the wire
          // type is narrower (only language clears to inherited).
          await updateAdminUserSettings(userId, patch as AdminUserSettingsPatch)
          setVersion(v => v + 1)
        }}
      >
        {(draft, set) => (
          <>
            <div>
              <label htmlFor="admin-display-name" className={fieldLabelClass}>
                Display name
              </label>
              <input
                id="admin-display-name"
                value={draft.displayName}
                onChange={e => set('displayName', e.target.value)}
                className={textInputClass}
              />
            </div>
            <div>
              <label htmlFor="admin-bio" className={fieldLabelClass}>
                Bio
              </label>
              <textarea
                id="admin-bio"
                rows={3}
                value={draft.bio}
                onChange={e => set('bio', e.target.value)}
                className={textInputClass}
              />
            </div>
            <div>
              <label
                htmlFor="admin-profile-visibility"
                className={fieldLabelClass}
              >
                Profile visibility
              </label>
              <select
                id="admin-profile-visibility"
                value={draft.profileVisibility}
                onChange={e =>
                  set('profileVisibility', e.target.value as ProfileVisibility)
                }
                className={textInputClass}
              >
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </div>
            <div>
              <label htmlFor="admin-locale" className={fieldLabelClass}>
                Interface locale
              </label>
              <select
                id="admin-locale"
                value={draft.locale}
                onChange={e => set('locale', e.target.value as Locale)}
                className={textInputClass}
              >
                {LOCALES.map(locale => (
                  <option key={locale} value={locale}>
                    {LOCALE_LABELS[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className={fieldLabelClass}>Lecturing language</p>
              <p className="mt-1 mb-2 text-sm text-slate-500">
                Speech recognition and generated slide text, unless a project or
                lecture overrides it.
              </p>
              <LanguageSelect
                value={draft.language}
                defaultLabel="browser setting"
                onChange={language => set('language', language ?? undefined)}
              />
            </div>
          </>
        )}
      </SettingsPanel>

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
                  <Link
                    to={`/app/admin/projects/${project.id}`}
                    className="font-medium text-slate-800 hover:underline"
                  >
                    {projectTitle(project)}{' '}
                    <span className="text-sm font-normal text-slate-400">
                      {projectDecks.length}{' '}
                      {projectDecks.length === 1 ? 'lecture' : 'lectures'} ·
                      updated {asDate(lastActivity(project, projectDecks))}
                    </span>
                  </Link>
                  <button
                    onClick={() =>
                      setPending({ kind: 'delete-project', project })
                    }
                    aria-label={`Delete project ${projectTitle(project)}`}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
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
                <LectureTable decks={otherDecks} onDelete={deleteDeck} />
              </details>
            )}
          </div>
        )}
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
