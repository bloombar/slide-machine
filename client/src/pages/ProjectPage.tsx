/**
 * One project: its decks, and starting a new lecture (deck) with a
 * chosen template (PROJ-2, TMPL-1).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Mic } from 'lucide-react'
import type { Deck, Project, Template } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import TemplatePicker from '../components/TemplatePicker'
import LectureRow from '../components/LectureRow'

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('classic')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([
      dispatchAction<Project>('project.get', { projectId }),
      dispatchAction<Deck[]>('deck.list', { projectId }),
      dispatchAction<Template[]>('template.list'),
    ])
      .then(([proj, deckList, templateList]) => {
        if (cancelled) return
        setProject(proj)
        setDecks(deckList)
        setTemplates(templateList)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this project')
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setError(null)
    try {
      const deck = await dispatchAction<Deck>('deck.create', {
        projectId,
        title: title.trim(),
        templateId,
      })
      navigate(`/d/${deck.permalinkSlug}`, { state: { startSpeaking: true } })
    } catch {
      setError('Could not create the lecture')
    }
  }

  return (
    <div>
      <header className="mb-8 flex items-center gap-4">
        <Link
          to="/app"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Projects
        </Link>
        <h1 className="text-2xl font-bold">{project?.title ?? 'Loading…'}</h1>
      </header>

      <section className="mb-10 max-w-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-700">
          Start a new lecture
        </h2>
        <form onSubmit={onCreate} className="flex flex-col gap-4">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Lecture title"
            aria-label="Lecture title"
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          {templates.length > 0 && (
            <TemplatePicker
              templates={templates}
              value={templateId}
              onChange={setTemplateId}
            />
          )}
          <button
            type="submit"
            className="flex items-center gap-2 self-start rounded-md bg-indigo-600 px-4 py-2 font-medium text-white"
          >
            <Mic className="h-4 w-4" aria-hidden />
            Start lecture
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>

      <section className="max-w-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-700">Lectures</h2>
        {decks.length === 0 ? (
          <p className="text-slate-500">No lectures yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {decks.map(d => (
              <LectureRow key={d.id} deck={d} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
