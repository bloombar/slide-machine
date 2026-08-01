/**
 * Profile page (SHARE-1 / AUTH-5): a user's display name and bio, then
 * the lectures the current viewer is allowed to see, grouped by project.
 * Private profiles and unknown users both read as "not found" — existence
 * never leaks.
 *
 * The owner and admins get an Edit button that turns the name and bio
 * into a form in place. The owner saves through their own action; an
 * admin saves through the audited admin endpoint after confirming, so
 * editing someone else's profile is never silent (ADMIN-5).
 *
 * The same two also get a Settings button for the account settings
 * (ProfileSettingsModal) — email, plan, profile visibility, lecturing
 * language, and sign out. This is where an admin edits someone else's
 * account (ADMIN-5); as with a project or a lecture, opening those
 * settings is confirmed once, on entry, and audited from then on.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { Pencil, Settings } from 'lucide-react'
import type { ProfileResponse, SafeUser } from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { dispatchAction } from '../api/actions'
import { updateAdminUserSettings } from '../api/admin'
import { useAuth } from '../auth/AuthContext'
import { projectTitle } from '../lib/project'
import ConfirmDialog from '../components/ConfirmDialog'
import LectureRow from '../components/LectureRow'
import ProfileSettingsModal from '../components/ProfileSettingsModal'

/** The standard content container (mirrors AppShell's main wrapper —
 * PublicShell leaves containment to its pages for the deck viewer). */
function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      {children}
    </div>
  )
}

/** The editable profile fields, as held by the form. */
interface ProfileDraft {
  displayName: string
  bio: string
}

const textInputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm'

const headerButton =
  'flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const { status, user: viewer, updateUser } = useAuth()
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [error, setError] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Set once an admin has acknowledged the audit notice; the settings
  // modal stays shut until then (ADMIN-5 confirms on entry, once).
  const [settingsConfirmed, setSettingsConfirmed] = useState(false)

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

  const isOwner = viewer?.id === profile.user.id
  // canEdit without ownership means an admin is looking (ADMIN-5)
  const asAdmin = profile.canEdit && !isOwner
  const askAdminSettings = settingsOpen && asAdmin && !settingsConfirmed

  const startEditing = () =>
    setDraft({
      displayName: profile.user.displayName,
      bio: profile.user.bio ?? '',
    })

  const cancelEditing = () => {
    setDraft(null)
    setSaveError(null)
  }

  /** Writes the draft, then folds it into the loaded profile so the page
   * reflects the save without a refetch. The owner's save also refreshes
   * the auth context, which is what the rest of the app reads. */
  const save = async () => {
    if (!draft || !userId) return
    setSaving(true)
    setSaveError(null)
    try {
      const patch = { displayName: draft.displayName.trim(), bio: draft.bio }
      if (isOwner) {
        updateUser(await dispatchAction<SafeUser>('user.updateProfile', patch))
      } else {
        // 204, so the local patch below is what updates the page
        await updateAdminUserSettings(userId, patch)
      }
      setProfile({
        ...profile,
        user: {
          ...profile.user,
          displayName: patch.displayName,
          bio: patch.bio.trim() || undefined,
        },
      })
      setDraft(null)
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : 'Could not save the profile.',
      )
    } finally {
      setSaving(false)
    }
  }

  /** An admin confirms first; the owner's own edit saves straight away. */
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!draft?.displayName.trim()) {
      setSaveError('Display name is required.')
      return
    }
    if (asAdmin) setConfirming(true)
    else void save()
  }

  return (
    <PageContainer>
      {draft ? (
        <form onSubmit={submit} className="mb-6 max-w-xl">
          <label
            htmlFor="profile-display-name"
            className="block text-sm font-medium text-slate-700"
          >
            Display name
          </label>
          <input
            id="profile-display-name"
            value={draft.displayName}
            onChange={e => setDraft({ ...draft, displayName: e.target.value })}
            className={`mt-1 ${textInputClass}`}
          />
          <label
            htmlFor="profile-bio"
            className="mt-4 block text-sm font-medium text-slate-700"
          >
            Bio
          </label>
          <textarea
            id="profile-bio"
            rows={4}
            value={draft.bio}
            onChange={e => setDraft({ ...draft, bio: e.target.value })}
            placeholder="A short introduction shown on your profile."
            className={`mt-1 ${textInputClass}`}
          />
          {saveError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold">{profile.user.displayName}</h1>
            <div className="flex shrink-0 gap-2">
              {profile.canEdit && (
                <button onClick={startEditing} className={headerButton}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </button>
              )}
              {profile.canEdit && (
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={headerButton}
                >
                  <Settings className="h-4 w-4" aria-hidden />
                  Settings
                </button>
              )}
            </div>
          </div>
          {profile.user.bio && (
            <p className="mb-6 whitespace-pre-line text-slate-600">
              {profile.user.bio}
            </p>
          )}
        </>
      )}

      {profile.projects.length === 0 ? (
        <p className="mt-6 text-slate-500">No lectures to show.</p>
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

      {confirming && (
        <ConfirmDialog
          title="Edit this user's profile?"
          message="This profile belongs to another user. You can change it as an admin; every change is recorded in the audit log."
          confirmLabel="Save changes"
          onConfirm={() => {
            setConfirming(false)
            void save()
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {settingsOpen && !askAdminSettings && (
        <ProfileSettingsModal
          adminUserId={asAdmin ? userId : undefined}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {askAdminSettings && (
        <ConfirmDialog
          title="Edit this user's settings?"
          message={`This account belongs to ${profile.user.displayName}. You can change their settings as an admin; every change is recorded in the audit log.`}
          confirmLabel="Edit settings"
          onConfirm={() => setSettingsConfirmed(true)}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </PageContainer>
  )
}
