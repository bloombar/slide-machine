/**
 * Live lecture session (CAP-1 minimal + GEN-1/GEN-3 via the mock
 * pipeline). Until real STT lands, phrases are typed — each one flows
 * through session.phrase and comes back as a SlideEvent, exactly the
 * contract the streamed pipeline will use.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { DeckViewResponse, Slide, SlideEvent } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { pollSlideImage } from '../api/slides'
import { useArrowKeys } from '../hooks/useArrowKeys'
import SlideView from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'

export default function SessionPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  const [slides, setSlides] = useState<Slide[]>([])
  const [current, setCurrent] = useState(0)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const pollCancelsRef = useRef<Map<string, () => void>>(new Map())

  // Stop any in-flight image polling when the session unmounts
  useEffect(() => {
    const cancels = pollCancelsRef.current
    return () => {
      cancels.forEach(cancel => cancel())
      cancels.clear()
    }
  }, [])

  /** Watches a slide whose image may still arrive from background enrichment. */
  const watchImage = (slide: Slide) => {
    if (!slide.imageKeywords?.length || slide.imageRef) return
    if (pollCancelsRef.current.has(slide.id)) return
    setPendingImages(prev => new Set(prev).add(slide.id))
    const cancel = pollSlideImage(slide.id, resolved => {
      pollCancelsRef.current.delete(slide.id)
      setPendingImages(prev => {
        const next = new Set(prev)
        next.delete(slide.id)
        return next
      })
      if (resolved) {
        setSlides(prev => prev.map(s => (s.id === resolved.id ? resolved : s)))
      }
    })
    pollCancelsRef.current.set(slide.id, cancel)
  }

  useEffect(() => {
    if (!deckId) return
    let cancelled = false
    dispatchAction<DeckViewResponse>('deck.get', { deckId })
      .then(v => {
        if (cancelled) return
        setView(v)
        setSlides(v.slides)
        setCurrent(Math.max(0, v.slides.length - 1))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this lecture')
      })
    return () => {
      cancelled = true
    }
  }, [deckId])

  const applyEvent = (event: SlideEvent) => {
    if (event.kind === 'none' || !event.slide) return
    const slide = event.slide
    setSlides(prev => {
      const next =
        event.kind === 'slide.update'
          ? prev.map(s => (s.id === slide.id ? slide : s))
          : [...prev, slide]
      setCurrent(next.length - 1)
      return next
    })
    watchImage(slide)
  }

  const onSpeak = async (e: FormEvent) => {
    e.preventDefault()
    if (!phrase.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const event = await dispatchAction<SlideEvent>('session.phrase', {
        deckId,
        phrase: phrase.trim(),
      })
      applyEvent(event)
      setPhrase('')
      inputRef.current?.focus()
    } catch {
      setError('Generation failed — try again')
    } finally {
      setBusy(false)
    }
  }

  const slideCount = slides.length
  useArrowKeys(
    useCallback(() => setCurrent(c => Math.max(0, c - 1)), []),
    useCallback(
      () => setCurrent(c => Math.min(slideCount - 1, c + 1)),
      [slideCount],
    ),
  )

  const slide = slides[current]

  return (
    <div className="flex flex-col">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-700">
          {view?.deck.title ?? 'Loading…'}
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">
            {slides.length
              ? `Slide ${current + 1} of ${slides.length}`
              : 'No slides yet'}
          </span>
          <button
            onClick={() => view && navigate(`/d/${view.deck.permalinkSlug}`)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white"
          >
            End session
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl flex-1">
        {slide && view ? (
          <SlideNavZones
            hasPrev={current > 0}
            hasNext={current < slides.length - 1}
            onPrev={() => setCurrent(c => Math.max(0, c - 1))}
            onNext={() => setCurrent(c => Math.min(slides.length - 1, c + 1))}
          >
            <SlideView
              slide={slide}
              template={view.template}
              imagePending={pendingImages.has(slide.id)}
            />
          </SlideNavZones>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
            Speak (type, for now) and slides will follow
          </div>
        )}
      </div>

      <form
        onSubmit={onSpeak}
        className="mx-auto mt-6 flex w-full max-w-4xl gap-2"
      >
        <input
          ref={inputRef}
          value={phrase}
          onChange={e => setPhrase(e.target.value)}
          placeholder="Say something about your topic…"
          aria-label="Spoken phrase"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-3"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Generating…' : 'Speak'}
        </button>
      </form>
      {error && (
        <p
          role="alert"
          className="mx-auto mt-2 w-full max-w-4xl text-sm text-red-600"
        >
          {error}
        </p>
      )}
    </div>
  )
}
