/**
 * Public deck viewer reached by permalink (SHARE-1) with basic playback
 * controls (PLAY-1: rewind/forward).
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { DeckViewResponse } from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { useArrowKeys } from '../hooks/useArrowKeys'
import SlideView from '../components/SlideView'

export default function DeckViewerPage() {
  const { slug } = useParams<{ slug: string }>()
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
      <main className="flex min-h-screen items-center justify-center bg-white text-slate-500">
        <p role="alert">{error}</p>
      </main>
    )
  }

  if (!view) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-slate-400">
        Loading…
      </main>
    )
  }

  const slide = view.slides[index]

  return (
    <main className="flex min-h-screen flex-col bg-white p-6 text-slate-900">
      <header className="mb-4 text-center">
        <h1 className="text-lg font-semibold text-slate-700">
          {view.deck.title}
        </h1>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1">
        {slide ? (
          <SlideView slide={slide} template={view.template} />
        ) : (
          <p className="text-center text-slate-400">This deck has no slides.</p>
        )}
      </div>
      {view.slides.length > 0 && (
        <nav className="mx-auto mt-4 flex items-center gap-4">
          <button
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-sm text-slate-500">
            {index + 1} / {view.slides.length}
          </span>
          <button
            onClick={() =>
              setIndex(i => Math.min(view.slides.length - 1, i + 1))
            }
            disabled={index === view.slides.length - 1}
            className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40"
          >
            Next →
          </button>
        </nav>
      )}
    </main>
  )
}
