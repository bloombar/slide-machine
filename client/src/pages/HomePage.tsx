/**
 * Authenticated home: every project as a sub-heading with its lectures
 * beneath, newest modification first. Each project shows at most
 * config.homeLecturesLimit lectures with a "Show all" expander, and a
 * dashed "New lecture" zone pinned to the top of its list. A "New
 * project" button in the header opens a modal that creates a project and
 * jumps straight to its page.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FolderPlus } from 'lucide-react'
import type { Deck, DeckImportResult, Project } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
import { userHandle } from '../lib/handle'
import { untitledLecture } from '../lib/lecture'
// Module-level translator for the load effect: stable, so it is not a
// dependency the way the hook's `t` is.
import { t as translate } from '../i18n'
import { projectTitle } from '../lib/project'
import LectureRow from '../components/LectureRow'
import NewLectureZone from '../components/NewLectureZone'
import ProjectRowMenu from '../components/ProjectRowMenu'
import NewProjectModal from '../components/NewProjectModal'
import UsageNotice from '../components/UsageNotice'
import DeckFeed from '../components/DeckFeed'
import { config } from '../config'

function ProjectSection({
  project,
  decks,
  onStartLecture,
  onImportLecture,
  onLectureDeleted,
  onProjectDeleted,
}: {
  project: Project
  decks: Deck[]
  onStartLecture: (project: Project) => void
  onImportLecture: (project: Project, file: File) => void
  onLectureDeleted: (deckId: string) => void
  onProjectDeleted: (projectId: string) => void
}) {
  const { t } = useTranslation()
  const limit = config.homeLecturesLimit
  const visible = decks.slice(0, limit)
  const hiddenCount = decks.length - limit

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-lg font-semibold">
          <Link
            to={`/app/projects/${project.id}`}
            className="hover:text-indigo-600"
          >
            {projectTitle(project)}
          </Link>
        </h2>
        <ProjectRowMenu
          project={project}
          onDeleted={onProjectDeleted}
          onImport={file => onImportLecture(project, file)}
        />
      </div>
      <ul className="flex flex-col gap-2">
        {/* Always first: a dashed zone to add a lecture */}
        <NewLectureZone
          projectTitle={projectTitle(project)}
          onStart={() => onStartLecture(project)}
        />
        {visible.map(d => (
          <LectureRow key={d.id} deck={d} onDeleted={onLectureDeleted} />
        ))}
      </ul>
      {hiddenCount > 0 && (
        <Link
          to={`/app/projects/${project.id}`}
          className="mt-2 inline-block ps-4 text-sm text-indigo-600"
        >
          {t('home.showAll', { count: decks.length })}
        </Link>
      )}
    </section>
  )
}

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [decksByProject, setDecksByProject] = useState<Map<string, Deck[]>>(
    new Map(),
  )
  const [creatingProject, setCreatingProject] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A success/warning notice after importing a lecture (EXP-3).
  const [notice, setNotice] = useState<string | null>(null)

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
        if (!cancelled) setError(translate('home.errors.load'))
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

  /** The kebab's Delete already removed the project server-side; drop it. */
  const removeProject = (projectId: string) => {
    setProjects(prev => (prev ?? []).filter(p => p.id !== projectId))
    setDecksByProject(prev => {
      const next = new Map(prev)
      next.delete(projectId)
      return next
    })
  }

  /** The dashed zone beside a project: new untitled lecture, straight in. */
  const startLecture = async (project: Project) => {
    setError(null)
    try {
      const deck = await dispatchAction<Deck>('deck.create', {
        projectId: project.id,
      })
      navigate(`/d/${deck.permalinkSlug}`, { state: { startSpeaking: true } })
    } catch {
      setError(t('lecture.errors.create'))
    }
  }

  /**
   * Imports a previously exported deck YAML as a new lecture in the given
   * project (EXP-3). The imported lecture is added to that project's list;
   * validation errors and non-fatal warnings are surfaced in place.
   */
  const importLecture = async (project: Project, file: File) => {
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
        projectId: project.id,
        content,
      })
      setDecksByProject(prev => {
        const next = new Map(prev)
        next.set(project.id, [result.deck, ...(next.get(project.id) ?? [])])
        return next
      })
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
      // A validation failure lists the specific problems; anything else is
      // a generic message. Nothing was created either way.
      setError(
        err instanceof ApiError && err.details?.length
          ? t('lecture.import.errors.invalid', {
              details: err.details.join(' '),
            })
          : t('lecture.import.errors.failed'),
      )
    }
  }

  /**
   * The empty-state zone: the user has no project yet, so spin up a
   * titleless default project on the fly and start the lecture in it.
   */
  const startFirstLecture = async () => {
    setError(null)
    try {
      const project = await dispatchAction<Project>('project.create', {})
      await startLecture(project)
    } catch {
      setError(t('lecture.errors.create'))
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="min-w-0 truncate text-2xl font-bold">
          {t('home.welcome', { name: user ? userHandle(user) : '' })}
        </h1>
        <button
          onClick={() => setCreatingProject(true)}
          className="flex shrink-0 items-center gap-2 rounded-md border border-indigo-600 px-4 py-2 font-medium text-indigo-600 hover:bg-indigo-50"
        >
          <FolderPlus className="h-4 w-4" aria-hidden />
          {t('project.new.action')}
        </button>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* A named region so your own projects stay tellable apart from the
            Discover sidebar, which lists other people's lectures beside them. */}
        <section
          aria-label={t('home.yourWork')}
          className="min-w-0 flex-1 lg:max-w-2xl"
        >
          {/* Only speaks up when something is close to a limit (BILL-4). */}
          <UsageNotice />
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
          {projects === null ? (
            <p className="text-slate-500">{t('common.loading')}</p>
          ) : projects.length === 0 ? (
            // No project yet: a dashed zone that creates a default project
            // and starts the first lecture in one click.
            <ul className="flex flex-col gap-2">
              <NewLectureZone onStart={() => void startFirstLecture()} />
            </ul>
          ) : (
            projects.map(p => (
              <ProjectSection
                key={p.id}
                project={p}
                decks={decksByProject.get(p.id) ?? []}
                onStartLecture={proj => void startLecture(proj)}
                onImportLecture={(proj, file) => void importLecture(proj, file)}
                onLectureDeleted={removeLecture}
                onProjectDeleted={removeProject}
              />
            ))
          )}
          {otherDecks.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold">
                {t('home.otherLectures')}
              </h2>
              <p className="mb-3 text-sm text-slate-500">
                {t('home.otherLecturesHint')}
              </p>
              <ul className="flex flex-col gap-2">
                {otherDecks.map(d => (
                  <LectureRow key={d.id} deck={d} onDeleted={removeLecture} />
                ))}
              </ul>
            </section>
          )}
        </section>

        {/* Discover (SOC-2/SOC-3): other people's public lectures alongside
            your own work, sticky so it stays put as the main column scrolls. */}
        <div className="w-full lg:sticky lg:top-6 lg:w-80 lg:shrink-0">
          <DeckFeed />
        </div>
      </div>

      {creatingProject && (
        <NewProjectModal
          onCreated={project => navigate(`/app/projects/${project.id}`)}
          onCancel={() => setCreatingProject(false)}
        />
      )}
    </div>
  )
}
