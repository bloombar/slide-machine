/**
 * One project: its lectures up front (newest modification first, like
 * the home screen), a dashed "New lecture" zone atop the list that starts
 * a new untitled lecture immediately, an in-place editable title, and a
 * settings icon on the title row opening the project settings modal
 * (seed material + danger zone).
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { Settings } from 'lucide-react'
import type { Deck, DeckImportResult, Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { projectTitle } from '../lib/project'
import { config } from '../config'
import LectureRow from '../components/LectureRow'
import NewLectureZone from '../components/NewLectureZone'
import EditableText from '../components/EditableText'
import ProjectSettingsModal, {
  type ProjectSettingsTabId,
} from '../components/ProjectSettingsModal'

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
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
        if (!cancelled) setError('Could not load this project')
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

  /** Starts a new untitled lecture and jumps straight into it. */
  const startLecture = async () => {
    setError(null)
    try {
      const deck = await dispatchAction<Deck>('deck.create', {
        projectId,
      })
      navigate(`/d/${deck.permalinkSlug}`, { state: { startSpeaking: true } })
    } catch {
      setError('Could not create the lecture')
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
      setError('Could not read that file')
      return
    }
    try {
      const result = await dispatchAction<DeckImportResult>('deck.import', {
        projectId,
        content,
      })
      setDecks(prev => [result.deck, ...prev])
      const name = result.deck.title || 'Untitled lecture'
      setNotice(
        result.warnings.length
          ? `Imported "${name}". ${result.warnings.join(' ')}`
          : `Imported "${name}".`,
      )
    } catch (err) {
      // A validation failure lists the specific problems; anything else is a
      // generic message. Nothing was created either way.
      if (err instanceof ApiError && err.details?.length) {
        setError(`Could not import this file: ${err.details.join(' ')}`)
      } else {
        setError('Could not import this file')
      }
    }
  }

  return (
    <div>
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">
          {project ? (
            <EditableText
              value={project.title}
              label="Project title"
              emptyDisplay={config.defaultProjectTitle}
              onSave={renameProject}
            />
          ) : (
            'Loading…'
          )}
        </h1>
        <button
          aria-label="Project settings"
          title="Project settings"
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
        <h2 className="mb-4 text-lg font-semibold text-slate-700">Lectures</h2>
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

      {settingsOpen && project && (
        <ProjectSettingsModal
          project={project}
          isOwner={user?.id === project.ownerId}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onProjectChange={setProject}
          onDeleted={() => void navigate('/app')}
        />
      )}
    </div>
  )
}
