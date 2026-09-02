/**
 * Authenticated home: every project as a sub-heading with its lectures
 * beneath, newest modification first. Each project shows at most
 * config.homeLecturesLimit lectures with a "Show all" expander, and a
 * dashed "New lecture" zone pinned to the top of its list. A "+" button
 * beside the welcome heading starts a project, a lecture, or an import.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Deck, Project } from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { takeReturnPath } from '../auth/returnPath'
import { dispatchAction } from '../api/actions'
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
import CreateMenu from '../components/CreateMenu'
import LectureImport from '../components/LectureImport'
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
  importPanel,
  justArrived,
}: {
  project: Project
  decks: Deck[]
  onStartLecture: (project: Project) => void
  onImportLecture: (project: Project) => void
  onLectureDeleted: (deckId: string) => void
  onProjectDeleted: (projectId: string) => void
  /** The import panel, when this is the project being imported into. It
   * belongs under the project whose kebab opened it — a panel at the top of
   * the page leaves the user looking at the wrong heading. */
  importPanel?: React.ReactNode
  /** The lecture that just arrived, marked briefly. */
  justArrived?: string | null
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
          onImport={() => onImportLecture(project)}
        />
      </div>
      {importPanel}
      <ul className="flex flex-col gap-2">
        {/* Always first: a dashed zone to add a lecture */}
        <NewLectureZone
          projectTitle={projectTitle(project)}
          onStart={() => onStartLecture(project)}
        />
        {visible.map(d => (
          <LectureRow
            key={d.id}
            deck={d}
            justArrived={d.id === justArrived}
            onDeleted={onLectureDeleted}
          />
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
  /** The project an import is landing in, and whether the panel is open
   * (EXP-3/EXP-5). The home screen is not inside a project, so one is
   * resolved before the panel can ask anything. */
  const [importInto, setImportInto] = useState<Project | null>(null)
  /** The lecture that just arrived, highlighted briefly so it is findable. */
  const [justArrived, setJustArrived] = useState<string | null>(null)

  // Google sign-in always lands here, having taken the whole tab (AUTH-8).
  // If the visitor started somewhere else — the sign-in dialog on a lecture —
  // that page parked itself before leaving, so hand them back to it. Read
  // once and cleared, so a later plain visit to /app stays on /app.
  useEffect(() => {
    const back = takeReturnPath()
    if (back) navigate(back, { replace: true })
  }, [navigate])

  // A pointer, not a state: it says "here it is" and then stops.
  useEffect(() => {
    if (!justArrived) return
    const id = setTimeout(() => setJustArrived(null), 2500)
    return () => clearTimeout(id)
  }, [justArrived])
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

  /**
   * Where a lecture goes when it was started without naming a project — the
   * header menu and the empty-state zone. Projects arrive newest-modified
   * first, so that is the one the user was last working in; with no project
   * at all, a titleless default one is spun up on the fly.
   */
  const targetProject = async (): Promise<Project> => {
    const recent = projects?.[0]
    if (recent) return recent
    const created = await dispatchAction<Project>('project.create', {})
    setProjects(prev => [...(prev ?? []), created])
    return created
  }

  /** Starts an untitled lecture in the target project. */
  const startLectureHere = async () => {
    setError(null)
    try {
      await startLecture(await targetProject())
    } catch {
      setError(t('lecture.errors.create'))
    }
  }

  /**
   * Opens the import panel against a project to land in (EXP-3/EXP-5).
   *
   * The home screen is not inside a project, so one is resolved first — the
   * most recent, or a fresh one — exactly as starting a lecture here does.
   */
  const openImport = async () => {
    setError(null)
    try {
      setImportInto(await targetProject())
    } catch {
      setError(t('project.errors.create'))
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* A named region so your own projects stay tellable apart from the
            Discover sidebar, which lists other people's lectures beside them. */}
        <section
          aria-label={t('home.yourWork')}
          className="min-w-0 flex-1 lg:max-w-2xl"
        >
          <div className="mb-8 flex items-center justify-between gap-4">
            <h1 className="min-w-0 truncate text-2xl font-bold">
              {t('home.welcome', { name: user ? userHandle(user) : '' })}
            </h1>
            <CreateMenu
              onNewProject={() => setCreatingProject(true)}
              onNewLecture={() => void startLectureHere()}
              onImportLecture={() => void openImport()}
            />
          </div>

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
              <NewLectureZone onStart={() => void startLectureHere()} />
            </ul>
          ) : (
            projects.map(p => (
              <ProjectSection
                key={p.id}
                project={p}
                decks={decksByProject.get(p.id) ?? []}
                onStartLecture={proj => void startLecture(proj)}
                onImportLecture={proj => setImportInto(proj)}
                justArrived={justArrived}
                onLectureDeleted={removeLecture}
                onProjectDeleted={removeProject}
                importPanel={
                  importInto?.id === p.id ? (
                    <div className="mb-3">
                      <LectureImport
                        projectId={p.id}
                        onImported={({ deck, warnings, report }) => {
                          setDecksByProject(prev => {
                            const next = new Map(prev)
                            next.set(p.id, [deck, ...(next.get(p.id) ?? [])])
                            return next
                          })
                          setJustArrived(deck.id)
                          const name = deck.title || untitledLecture()
                          const summary = report
                            ? ` ${t('lecture.importSlides.report.summary', {
                                slides: report.slidesRead,
                                layouts: report.layoutsCreated,
                              })}`
                            : ''
                          setNotice(
                            (warnings?.length
                              ? t('lecture.import.importedWithWarnings', {
                                  name,
                                  warnings: warnings.join(' '),
                                })
                              : t('lecture.import.imported', { name })) +
                              summary,
                          )
                          // Done is done: the panel closes behind it.
                          setImportInto(null)
                        }}
                        onClose={() => setImportInto(null)}
                      />
                    </div>
                  ) : null
                }
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
            your own work, sticky so it stays put as the main column scrolls.
            The offset is where the panel already sits unscrolled (header
            3.5rem + this page's 2rem of padding), so a long list of projects
            scrolling past it never shifts it or tucks it under the header,
            and its height can be sized once, clear of the sticky footer. */}
        <div className="w-full lg:sticky lg:top-22 lg:w-[28rem] lg:shrink-0">
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
