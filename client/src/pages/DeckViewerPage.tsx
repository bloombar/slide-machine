/**
 * Public deck viewer reached by permalink (SHARE-1). Playback (PLAY-1)
 * and the carousel/list switch come from the shared slide-navigation
 * codebase (useSlideNavigation + SlideNavZones + ViewModeToggle). The
 * deck's owner also gets a "Resume lecture" affordance — ending a
 * session never closes it (CAP-1).
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Mic, Pencil } from 'lucide-react'
import type { DeckViewResponse } from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import SlideView from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import ViewModeToggle, { type ViewMode } from '../components/ViewModeToggle'

export default function DeckViewerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  const [mode, setMode] = useState<ViewMode>('carousel')
  const [error, setError] = useState<string | null>(null)
  const nav = useSlideNavigation(view?.slides.length ?? 0, mode)

  useEffect(() => {
    let cancelled = false
    apiFetch<DeckViewResponse>(`/api/decks/${slug}`)
      .then(v => {
        if (!cancelled) setView(v)
      })
      .catch(err => {
        if (cancelled) return
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This deck does not exist or is private'
            : 'Could not load this deck',
        )
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        <p role="alert">{error}</p>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        Loading…
      </div>
    )
  }

  const slide = view.slides[nav.current]
  const isOwner = user?.id === view.deck.ownerId

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6">
      <header className="mb-4 grid grid-cols-3 items-center">
        <ViewModeToggle mode={mode} onChange={setMode} />
        <h1 className="text-center text-lg font-semibold text-slate-700">
          {view.deck.title}
        </h1>
        <div className="flex items-center justify-end gap-1">
          {isOwner && (
            <>
              <Link
                to={`/app/decks/${view.deck.id}/edit`}
                aria-label="Edit lecture"
                className="rounded-md p-2 text-slate-500 hover:text-slate-900"
              >
                <Pencil className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                to={`/app/session/${view.deck.id}`}
                aria-label="Resume lecture"
                className="rounded-md p-2 text-slate-500 hover:text-slate-900"
              >
                <Mic className="h-5 w-5" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </header>

      {view.slides.length === 0 ? (
        <p className="text-center text-slate-400">This deck has no slides.</p>
      ) : mode === 'carousel' ? (
        <>
          <div className="mx-auto w-full max-w-4xl flex-1">
            <SlideNavZones
              hasPrev={nav.hasPrev}
              hasNext={nav.hasNext}
              onPrev={nav.goPrev}
              onNext={nav.goNext}
            >
              <SlideView slide={slide!} template={view.template} />
            </SlideNavZones>
          </div>
          <p className="mx-auto mt-4 text-sm text-slate-500">
            {nav.current + 1} / {view.slides.length}
          </p>
        </>
      ) : (
        <ul className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {view.slides.map((s, i) => (
            <li key={s.id} ref={nav.registerItem(i)}>
              <SlideView slide={s} template={view.template} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
