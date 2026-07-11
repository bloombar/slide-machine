/**
 * Public deck viewer reached by permalink (SHARE-1) with basic playback
 * controls (PLAY-1: rewind/forward). The deck's owner also gets a
 * "Resume lecture" affordance — ending a session never closes it
 * (CAP-1); speaking can continue any time.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Mic } from 'lucide-react'
import type { DeckViewResponse } from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { useArrowKeys } from '../hooks/useArrowKeys'
import SlideView from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'

export default function DeckViewerPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)

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

  const slideCount = view?.slides.length ?? 0
  useArrowKeys(
    useCallback(() => setIndex(i => Math.max(0, i - 1)), []),
    useCallback(
      () => setIndex(i => Math.min(slideCount - 1, i + 1)),
      [slideCount],
    ),
  )

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

  const slide = view.slides[index]
  const isOwner = user?.id === view.deck.ownerId

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6">
      <header className="mb-4 grid grid-cols-3 items-center">
        <div />
        <h1 className="text-center text-lg font-semibold text-slate-700">
          {view.deck.title}
        </h1>
        <div className="text-right">
          {isOwner && (
            <Link
              to={`/app/session/${view.deck.id}`}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
            >
              <Mic className="h-4 w-4" aria-hidden />
              Resume lecture
            </Link>
          )}
        </div>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1">
        {slide ? (
          <SlideNavZones
            hasPrev={index > 0}
            hasNext={index < view.slides.length - 1}
            onPrev={() => setIndex(i => Math.max(0, i - 1))}
            onNext={() =>
              setIndex(i => Math.min(view.slides.length - 1, i + 1))
            }
          >
            <SlideView slide={slide} template={view.template} />
          </SlideNavZones>
        ) : (
          <p className="text-center text-slate-400">This deck has no slides.</p>
        )}
      </div>
      {view.slides.length > 0 && (
        <p className="mx-auto mt-4 text-sm text-slate-500">
          {index + 1} / {view.slides.length}
        </p>
      )}
    </div>
  )
}
