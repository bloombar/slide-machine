/**
 * Authenticated home: greets the user and proves the action layer end to
 * end with project list/create (PROJ-1 via TECH-13).
 */
import { useEffect, useState, type FormEvent } from 'react'
import type { Project } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'

export default function HomePage() {
  const { user, logout } = useAuth()
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
    <main className="min-h-screen bg-slate-900 p-8 text-slate-100">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Welcome, {user?.displayName}</h1>
        <button
          onClick={() => void logout()}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium"
        >
          Sign out
        </button>
      </header>

      <section className="max-w-xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-300">
          Your projects
        </h2>
        <form onSubmit={onCreate} className="mb-4 flex gap-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="New project title"
            aria-label="New project title"
            className="flex-1 rounded-md bg-slate-800 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium"
          >
            Create
          </button>
        </form>
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {error}
          </p>
        )}
        {projects === null ? (
          <p className="text-slate-400">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-slate-400">
            No projects yet — create your first one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map(p => (
              <li key={p.id} className="rounded-lg bg-slate-800 px-4 py-3">
                {p.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
