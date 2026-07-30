/**
 * One project: its lectures up front (newest modification first, like
 * the home screen), a dashed "New lecture" zone atop the list that starts
 * a new untitled lecture immediately, an in-place editable title, and a
 * settings icon on the title row opening the project settings modal
 * (seed material + danger zone).
 *
 * An allowlisted admin reaches this page from the admin console and
 * edits the project's settings in that same modal (ADMIN-5). Because
 * they are not the owner, opening it is confirmed first and every change
 * they make is audited server-side.
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import type { Deck, DeckImportResult, Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { projectTitle, untitledProject } from '../lib/project'
import { untitledLecture } from '../lib/lecture'
// Module-level translator for the load effect: stable, so it is not a
// dependency the way the hook's `t` is.
import { t as translate } from '../i18n'
import ConfirmDialog from '../components/ConfirmDialog'
import LectureRow from '../components/LectureRow'
import NewLectureZone from '../components/NewLectureZone'
import EditableText from '../components/EditableText'
import ProjectSettingsModal, {
  type ProjectSettingsTabId,
} from '../components/ProjectSettingsModal'

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = useIsAdmin()
  const [project, setProject] = useState<Project | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const location = useLocation()
  // A lecture's settings link or the home kebab deep-links into the
  // project settings, optionally on a specific tab.
  const navState = location.state as {
    openSettings?: boolean
    settingsTab?: ProjectSettingsTabId
  } | null
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() =>
    Boolean(navState?.openSettings),
  )
  const [settingsTab, setSettingsTab] = useState<ProjectSettingsTabId>(
    () => navState?.settingsTab ?? 'general',
  )
  const [error, setError] = useState<string | null>(null)
  // A success/warning notice after importing a lecture (EXP-3).
  const [notice, setNotice] = useState<string | null>(null)
  // Set once the admin has acknowledged the confirm dialog below; the
  // settings modal stays shut until then (ADMIN-5 wants the edit
  // acknowledged, and the deep link opens settings on its own).
  const [adminEditConfirmed, setAdminEditConfirmed] = useState(false)

  // Scrub the deep-link state so a reload doesn't re-open settings
  useEffect(() => {
    if (navState?.openSettings) {
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([
      dispatchAction<Project>('project.get', { projectId }),
      dispatchAction<Deck[]>('deck.list', { projectId }),
    ])
      .then(([proj, deckList]) => {
        if (cancelled) return
        setProject(proj)
        setDecks(deckList)
      })
      .catch(() => {
        if (!cancelled) setError(translate('project.errors.load'))
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  /** Renames the project in place; empty titles are ignored. */
  const renameProject = (title: string) => {
    if (!title.trim() || !project) return
    dispatchAction<Project>('project.update', {
      projectId,
      title: title.trim(),
    })
      .then(setProject)
      .catch(() => {
        // Quiet failure: the title reverts to the saved value
      })
  }

  // Editing rights the ordinary way: the owner, or someone the project
  // was shared with as an editor. Anyone else who got this far and is an
  // admin edits on the allowlist's authority instead, which is audited.
  const canEdit =
    !!project &&
    (project.ownerId === user?.id ||
      (project.editors ?? []).includes(user?.id ?? ''))
  const adminOverride = !canEdit && isAdmin === true
  // The admin check is still in flight, so which of the two it is —
  // an admin about to be asked, or a plain viewer — is not known yet.
  const rightsPending = !canEdit && isAdmin === null
  const askAdmin = settingsOpen && adminOverride && !adminEditConfirmed

  /** Starts a new untitled lecture and jumps straight into it. */
  const startLecture = async () => {
    setError(null)
    try {
      const deck = await dispatchAction<Deck>('deck.create', {
        projectId,
      })
      navigate(`/d/${deck.permalinkSlug}`, { state: { startSpeaking: true } })
    } catch {
      setError(t('lecture.errors.create'))
    }
  }

  /**
   * Imports a previously exported deck YAML as a new lecture (EXP-3). The
   * created lecture is added to the top of the list; validation errors and
   * non-fatal warnings (e.g. a substituted template) are surfaced in place.
   */
  const importLecture = async (file: File) => {
    setError(null)
    setNotice(null)
    let content: string
    try {
      content = await file.text()
    } catch {
      setError(t('lecture.import.errors.read'))
      return
    }
    try {
      const result = await dispatchAction<DeckImportResult>('deck.import', {
        projectId,
        content,
      })
      setDecks(prev => [result.deck, ...prev])
      const name = result.deck.title || untitledLecture()
      setNotice(
        result.warnings.length
          ? t('lecture.import.importedWithWarnings', {
              name,
              warnings: result.warnings.join(' '),
            })
          : t('lecture.import.imported', { name }),
      )
    } catch (err) {
      // A validation failure lists the specific problems; anything else is a
      // generic message. Nothing was created either way.
      setError(
        err instanceof ApiError && err.details?.length
          ? t('lecture.import.errors.invalid', {
              details: err.details.join(' '),
            })
          : t('lecture.import.errors.failed'),
      )
    }
  }

  return (
    <div>
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">
          {project ? (
            <EditableText
              value={project.title}
              label={t('project.titleLabel')}
              emptyDisplay={untitledProject()}
              onSave={renameProject}
            />
          ) : (
            t('common.loading')
          )}
        </h1>
        <button
          aria-label={t('project.settings.title')}
          title={t('project.settings.title')}
          onClick={() => {
            setSettingsTab('general')
            setSettingsOpen(true)
          }}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <Settings className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <section className="max-w-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-700">
          {t('project.lectures')}
        </h2>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-4 text-sm text-slate-600">
            {notice}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {/* Always first: a dashed zone to add or import a lecture */}
          {project && (
            <NewLectureZone
              projectTitle={projectTitle(project)}
              onStart={() => void startLecture()}
              onImport={file => void importLecture(file)}
            />
          )}
          {decks.map(d => (
            <LectureRow
              key={d.id}
              deck={d}
              onDeleted={id =>
                setDecks(prev => prev.filter(deck => deck.id !== id))
              }
            />
          ))}
        </ul>
      </section>

      {settingsOpen && project && !rightsPending && !askAdmin && (
        <ProjectSettingsModal
          project={project}
          isOwner={user?.id === project.ownerId}
          adminOverride={adminOverride}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onProjectChange={setProject}
          onDeleted={() => void navigate('/app')}
        />
      )}

      {askAdmin && project && (
        <ConfirmDialog
          title={t('project.adminSettings.title')}
          message={t('project.adminSettings.message', {
            name: projectTitle(project),
          })}
          confirmLabel={t('profile.adminSettings.confirm')}
          onConfirm={() => setAdminEditConfirmed(true)}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
