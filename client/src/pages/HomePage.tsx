/**
 * Authenticated home: every project as a sub-heading with its lectures
 * beneath, newest modification first. Each project shows at most
 * config.homeLecturesLimit lectures with a "Show all" expander.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import type { Deck, Project } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { userHandle } from '../lib/handle'
import { config } from '../config'

function LectureRow({ deck }: { deck: Deck }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-2">
      <span>{deck.title}</span>
      <span className="flex gap-3 text-sm">
        <Link to={`/app/session/${deck.id}`} className="text-indigo-600">
          Resume
        </Link>
        <Link to={`/app/decks/${deck.id}/edit`} className="text-slate-600">
          Edit
        </Link>
        <Link to={`/d/${deck.permalinkSlug}`} className="text-slate-500">
          View
        </Link>
      </span>
    </li>
  )
}

function ProjectSection({
  project,
  decks,
}: {
  project: Project
  decks: Deck[]
}) {
  const [expanded, setExpanded] = useState(false)
  const limit = config.homeLecturesLimit
  const visible = expanded ? decks : decks.slice(0, limit)
  const hiddenCount = decks.length - limit

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">
        <Link
          to={`/app/projects/${project.id}`}
          className="hover:text-indigo-600"
        >
          {project.title}
        </Link>
      </h2>
      {decks.length === 0 ? (
        <p className="text-sm text-slate-500">
          No lectures yet —{' '}
          <Link to={`/app/projects/${project.id}`} className="text-indigo-600">
            start one
          </Link>
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {visible.map(d => (
              <LectureRow key={d.id} deck={d} />
            ))}
          </ul>
          {!expanded && hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 text-sm text-indigo-600"
            >
              Show all {decks.length} lectures
            </button>
          )}
        </>
      )}
    </section>
  )
}

export default function HomePage() {
  const { user } = useAuth()
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
        setProjects(projectList)
        setDecksByProject(grouped)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load projects')
      })
    return () => {
      cancelled = true
    }
  }, [])

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
            />
          ))
        )}
      </div>
    </div>
  )
}
