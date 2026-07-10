/**
 * Authenticated home: greets the user and lists/creates projects via
 * the action layer (PROJ-1 via TECH-13).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import type { Project } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { userHandle } from '../lib/handle'

export default function HomePage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    dispatchAction<Project[]>('project.list')
      .then(list => {
        if (!cancelled) setProjects(list)
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

      <section className="max-w-xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-700">
          Your projects
        </h2>
        <form onSubmit={onCreate} className="mb-4 flex gap-2">
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
          <ul className="flex flex-col gap-2">
            {projects.map(p => (
              <li key={p.id}>
                <Link
                  to={`/app/projects/${p.id}`}
                  className="block rounded-md border border-slate-200 px-4 py-3 hover:border-slate-300 hover:bg-slate-50"
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
