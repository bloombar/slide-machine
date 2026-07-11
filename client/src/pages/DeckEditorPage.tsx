/**
 * Deck editor (EDIT-1): carousel and list views via the shared
 * slide-navigation codebase (useSlideNavigation + SlideNavZones +
 * ViewModeToggle). Edits auto-save (debounced); slides can be reordered
 * and deleted.
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowDown, ArrowUp, Mic, Trash2 } from 'lucide-react'
import type { Deck, DeckViewResponse, Slide } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import SlideView from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import SlideEditorFields from '../components/SlideEditorFields'
import DeckPageHeader from '../components/DeckPageHeader'
import { type ViewMode } from '../components/ViewModeToggle'

export default function DeckEditorPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  const [slides, setSlides] = useState<Slide[]>([])
  const [mode, setMode] = useState<ViewMode>('carousel')
  const [error, setError] = useState<string | null>(null)
  const nav = useSlideNavigation(slides.length, mode)
  const { setCurrent } = nav

  useEffect(() => {
    if (!deckId) return
    let cancelled = false
    dispatchAction<DeckViewResponse>('deck.get', { deckId })
      .then(v => {
        if (cancelled) return
        setView(v)
        setSlides(v.slides)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this deck')
      })
    return () => {
      cancelled = true
    }
  }, [deckId])

  const updateSlide = (updated: Slide) =>
    setSlides(prev => prev.map(s => (s.id === updated.id ? updated : s)))

  const deleteSlide = async (slideId: string) => {
    try {
      await dispatchAction('slide.delete', { slideId })
      setSlides(prev => prev.filter(s => s.id !== slideId))
      setCurrent(c => Math.max(0, Math.min(c, slides.length - 2)))
    } catch {
      setError('Could not delete the slide')
    }
  }

  const moveSlide = async (slideId: string, delta: -1 | 1) => {
    const ids = slides.map(s => s.id)
    const from = ids.indexOf(slideId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
    // Optimistic: reflect the new order immediately, then persist
    setSlides(prev => {
      const byId = new Map(prev.map(s => [s.id, s]))
      return ids.map(id => byId.get(id)!)
    })
    try {
      await dispatchAction<Deck>('deck.reorderSlides', {
        deckId,
        slideOrder: ids,
      })
    } catch {
      setError('Could not reorder — reload to see the saved order')
    }
  }

  if (error && !view) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500">
        <p role="alert">{error}</p>
      </div>
    )
  }
  if (!view) {
    return <p className="text-slate-400">Loading…</p>
  }

  const slide = slides[Math.min(nav.current, slides.length - 1)]

  return (
    <div>
      <DeckPageHeader
        mode={mode}
        onModeChange={setMode}
        title={view.deck.title}
        actions={
          <Link
            to={`/app/session/${view.deck.id}`}
            aria-label="Resume lecture"
            className="rounded-md p-2 text-slate-500 hover:text-slate-900"
          >
            <Mic className="h-5 w-5" aria-hidden />
          </Link>
        }
      />

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {slides.length === 0 ? (
        <p className="text-slate-500">This deck has no slides yet.</p>
      ) : mode === 'carousel' ? (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <SlideNavZones
            hasPrev={nav.hasPrev}
            hasNext={nav.hasNext}
            onPrev={nav.goPrev}
            onNext={nav.goNext}
          >
            <SlideView slide={slide!} template={view.template} />
          </SlideNavZones>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {Math.min(nav.current, slides.length - 1) + 1} / {slides.length}
            </p>
            <button
              aria-label="Delete slide"
              onClick={() => void deleteSlide(slide!.id)}
              className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </button>
          </div>
          <SlideEditorFields
            key={slide!.id}
            slide={slide!}
            onSaved={updateSlide}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-6">
          {slides.map((s, i) => (
            <li
              key={s.id}
              ref={nav.registerItem(i)}
              className="grid gap-4 md:grid-cols-2"
            >
              <div>
                <SlideView slide={s} template={view.template} />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <span className="mr-auto text-sm text-slate-400">
                    Slide {i + 1}
                  </span>
                  <button
                    aria-label={`Move slide ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => void moveSlide(s.id, -1)}
                    className="rounded-md p-2 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    aria-label={`Move slide ${i + 1} down`}
                    disabled={i === slides.length - 1}
                    onClick={() => void moveSlide(s.id, 1)}
                    className="rounded-md p-2 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    aria-label={`Delete slide ${i + 1}`}
                    onClick={() => void deleteSlide(s.id)}
                    className="rounded-md p-2 text-slate-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <SlideEditorFields key={s.id} slide={s} onSaved={updateSlide} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
