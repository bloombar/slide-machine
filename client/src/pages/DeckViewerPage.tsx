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
import type { DeckViewResponse, Slide } from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { dispatchAction } from '../api/actions'
import { useAuth } from '../auth/AuthContext'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import SlideView, { type SlideTextPatch } from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import DeckPageHeader from '../components/DeckPageHeader'
import { type ViewMode } from '../components/ViewModeToggle'

export default function DeckViewerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, status } = useAuth()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  const [mode, setMode] = useState<ViewMode>('carousel')
  const [error, setError] = useState<string | null>(null)
  const nav = useSlideNavigation(view?.slides.length ?? 0, mode)

  useEffect(() => {
    // Wait for session restore: a pasted permalink must send the owner's
    // credentials or a private deck would 404 before login completes
    if (status === 'restoring') return
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
  }, [slug, status])

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

  /** In-place edits (EDIT-1) persist through the same action as the editor. */
  const editSlide = (slideId: string) => (patch: SlideTextPatch) => {
    dispatchAction<Slide>('slide.editContent', { slideId, ...patch })
      .then(updated =>
        setView(v =>
          v
            ? {
                ...v,
                slides: v.slides.map(s => (s.id === updated.id ? updated : s)),
              }
            : v,
        ),
      )
      .catch(() => {
        // Quiet failure: the on-screen text simply reverts to the saved value
      })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6">
      <DeckPageHeader
        mode={mode}
        onModeChange={setMode}
        title={view.deck.title}
        actions={
          isOwner && (
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
          )
        }
      />

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
              <SlideView
                slide={slide!}
                template={view.template}
                editable={isOwner}
                onEdit={editSlide(slide!.id)}
              />
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
              <SlideView
                slide={s}
                template={view.template}
                editable={isOwner}
                onEdit={editSlide(s.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
