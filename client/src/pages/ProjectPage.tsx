/**
 * One project: its lectures up front (newest modification first, like
 * the home screen), a + beside the heading that starts a new untitled
 * lecture immediately, an in-place editable title, and a settings icon
 * on the title row opening the
 * project settings modal (seed material + danger zone).
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Plus, Settings } from 'lucide-react'
import type { Deck, Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { useAuth } from '../auth/AuthContext'
import LectureRow from '../components/LectureRow'
import EditableText from '../components/EditableText'
import ProjectSettingsModal from '../components/ProjectSettingsModal'

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        templateId: 'classic',
      })
      navigate(`/d/${deck.permalinkSlug}`, { state: { startSpeaking: true } })
    } catch {
      setError('Could not create the lecture')
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
              onSave={renameProject}
            />
          ) : (
            'Loading…'
          )}
        </h1>
        <button
          aria-label="Project settings"
          title="Project settings"
          onClick={() => setSettingsOpen(true)}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <Settings className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <section className="max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-700">Lectures</h2>
          <button
            aria-label="Start a new lecture"
            title="Start a new lecture"
            onClick={() => void startLecture()}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}
        {decks.length === 0 ? (
          <p className="text-slate-500">
            No lectures yet — use + to start one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
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
        )}
      </section>

      {settingsOpen && project && (
        <ProjectSettingsModal
          project={project}
          isOwner={user?.id === project.ownerId}
          onClose={() => setSettingsOpen(false)}
          onProjectChange={setProject}
          onDeleted={() => void navigate('/app')}
        />
      )}
    </div>
  )
}
