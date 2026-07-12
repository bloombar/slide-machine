/**
 * Authenticated home: every project as a sub-heading with its lectures
 * beneath, newest modification first. Each project shows at most
 * config.homeLecturesLimit lectures with a "Show all" expander.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import type { Deck, Project } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { userHandle } from '../lib/handle'
import LectureRow from '../components/LectureRow'
import { config } from '../config'

function ProjectSection({
  project,
  decks,
  onStartLecture,
  onLectureDeleted,
}: {
  project: Project
  decks: Deck[]
  onStartLecture: (project: Project) => void
  onLectureDeleted: (deckId: string) => void
}) {
  const limit = config.homeLecturesLimit
  const visible = decks.slice(0, limit)
  const hiddenCount = decks.length - limit

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold">
          <Link
            to={`/app/projects/${project.id}`}
            className="hover:text-indigo-600"
          >
            {project.title}
          </Link>
        </h2>
        <button
          aria-label={`Start a new lecture in ${project.title}`}
          title="Start a new lecture"
          onClick={() => onStartLecture(project)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {decks.length === 0 ? (
        <p className="text-sm text-slate-500">
          No lectures yet —{' '}
          <button
            onClick={() => onStartLecture(project)}
            className="cursor-pointer text-indigo-600 hover:underline"
          >
            start one
          </button>
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {visible.map(d => (
              <LectureRow key={d.id} deck={d} onDeleted={onLectureDeleted} />
            ))}
          </ul>
          {hiddenCount > 0 && (
            <Link
              to={`/app/projects/${project.id}`}
              className="mt-2 inline-block text-sm text-indigo-600"
            >
              Show all {decks.length} lectures
            </Link>
          )}
        </>
      )}
    </section>
  )
}

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [decksByProject, setDecksByProject] = useState<Map<string, Deck[]>>(
    new Map(),
  )
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      dispatchAction<Project[]>('project.list'),
      dispatchAction<Deck[]>('deck.list'),
    ])
      .then(([projectList, decks]) => {
        if (cancelled) return
        // decks arrive sorted by updatedAt desc; grouping preserves order
        const grouped = new Map<string, Deck[]>()
        for (const deck of decks) {
          grouped.set(deck.projectId, [
            ...(grouped.get(deck.projectId) ?? []),
            deck,
          ])
        }
        // Merge, don't replace: a project created while this request was
        // in flight must survive the stale response landing after it
        setProjects(prev => {
          const known = new Set(projectList.map(p => p.id))
          return [...(prev ?? []).filter(p => !known.has(p.id)), ...projectList]
        })
        setDecksByProject(grouped)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load projects')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Decks owned here but living in someone else's project (ownership
  // was transferred in)
  const otherDecks =
    projects === null
      ? []
      : [...decksByProject.entries()]
          .filter(([projectId]) => !projects.some(p => p.id === projectId))
          .flatMap(([, list]) => list)

  /** A row's Delete already removed it server-side; drop it locally. */
  const removeLecture = (deckId: string) => {
    setDecksByProject(prev => {
      const next = new Map(prev)
      for (const [projectId, list] of next) {
        next.set(
          projectId,
          list.filter(d => d.id !== deckId),
        )
      }
      return next
    })
  }

  /** The + beside a project: new untitled lecture, straight in. */
  const startLecture = async (project: Project) => {
    setError(null)
    try {
      const deck = await dispatchAction<Deck>('deck.create', {
        projectId: project.id,
        templateId: 'classic',
      })
      navigate(`/d/${deck.permalinkSlug}`, { state: { startSpeaking: true } })
    } catch {
      setError('Could not create the lecture')
    }
  }

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setError(null)
    try {
      const project = await dispatchAction<Project>('project.create', {
        title: title.trim(),
      })
      setProjects(prev => [project, ...(prev ?? [])])
      setTitle('')
    } catch {
      setError('Could not create the project')
    }
  }

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold">
        Welcome, {user ? userHandle(user) : ''}
      </h1>

      <div className="max-w-2xl">
        <form onSubmit={onCreate} className="mb-8 flex gap-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="New project title"
            aria-label="New project title"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2"
          />
          <button
            type="submit"
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Create
          </button>
        </form>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}
        {projects === null ? (
          <p className="text-slate-500">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-slate-500">
            No projects yet — create your first one above.
          </p>
        ) : (
          projects.map(p => (
            <ProjectSection
              key={p.id}
              project={p}
              decks={decksByProject.get(p.id) ?? []}
              onStartLecture={proj => void startLecture(proj)}
              onLectureDeleted={removeLecture}
            />
          ))
        )}
        {otherDecks.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">Other lectures</h2>
            <p className="mb-3 text-sm text-slate-500">
              Lectures you own inside other people&apos;s projects.
            </p>
            <ul className="flex flex-col gap-2">
              {otherDecks.map(d => (
                <LectureRow key={d.id} deck={d} onDeleted={removeLecture} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
