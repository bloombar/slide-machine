/**
 * Deck viewer reached by permalink (SHARE-1) — and, for the deck's
 * owner, the single surface for everything: in-place text editing,
 * adding/deleting/reordering slides, and the live session. The
 * microphone icon toggles the (typed, until STT lands) "Speak" bar,
 * whose phrases flow through session.phrase exactly as the streamed
 * pipeline will (GEN-1/CAP-1). Playback and the carousel/list switch
 * come from the shared slide-navigation codebase.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { Mic, Plus, Settings } from 'lucide-react'
import type {
  Deck,
  DeckViewResponse,
  Slide,
  SlideEvent,
} from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { dispatchAction } from '../api/actions'
import { pollSlideImage } from '../api/slides'
import { useAuth } from '../auth/AuthContext'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import SlideView, { type SlideTextPatch } from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import SlideDeleteButton from '../components/SlideDeleteButton'
import DraggableListRow from '../components/DraggableListRow'
import EditableText from '../components/EditableText'
import DeckPageHeader from '../components/DeckPageHeader'
import DeckSettingsModal from '../components/DeckSettingsModal'
import { type ViewMode } from '../components/ViewModeToggle'

export default function DeckViewerPage() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, status } = useAuth()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  const [mode, setMode] = useState<ViewMode>('carousel')
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [speaking, setSpeaking] = useState<boolean>(() =>
    Boolean(
      (location.state as { startSpeaking?: boolean } | null)?.startSpeaking,
    ),
  )
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [speakError, setSpeakError] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const pollCancelsRef = useRef<Map<string, () => void>>(new Map())
  const nav = useSlideNavigation(view?.slides.length ?? 0, mode)
  const { setCurrent } = nav

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

  // Stop any in-flight image polling when the viewer unmounts
  useEffect(() => {
    const cancels = pollCancelsRef.current
    return () => {
      cancels.forEach(cancel => cancel())
      cancels.clear()
    }
  }, [])

  // Opening the live session focuses the phrase input
  useEffect(() => {
    if (speaking) inputRef.current?.focus()
  }, [speaking])

  // "Start lecture" hands over with startSpeaking in router state (read
  // by the lazy initializer above); scrub it so a reload doesn't re-open
  // the mic — history.state survives reloads
  useEffect(() => {
    if ((location.state as { startSpeaking?: boolean } | null)?.startSpeaking) {
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /** Watches a slide whose image may still arrive from background enrichment. */
  const watchImage = (target: Slide) => {
    if (!target.imageKeywords?.length || target.imageRef) return
    if (pollCancelsRef.current.has(target.id)) return
    setPendingImages(prev => new Set(prev).add(target.id))
    const cancel = pollSlideImage(target.id, resolved => {
      pollCancelsRef.current.delete(target.id)
      setPendingImages(prev => {
        const next = new Set(prev)
        next.delete(target.id)
        return next
      })
      if (resolved) {
        setView(v =>
          v
            ? {
                ...v,
                slides: v.slides.map(s =>
                  s.id === resolved.id ? resolved : s,
                ),
              }
            : v,
        )
      }
    })
    pollCancelsRef.current.set(target.id, cancel)
  }

  /** Applies a generation event: new slides append, updates replace. */
  const applyEvent = (event: SlideEvent) => {
    if (event.kind === 'none' || !event.slide) return
    const next = event.slide
    const isNew = event.kind === 'slide.new'
    setView(v =>
      v
        ? {
            ...v,
            deck: isNew
              ? { ...v.deck, slideOrder: [...v.deck.slideOrder, next.id] }
              : v.deck,
            slides: isNew
              ? [...v.slides, next]
              : v.slides.map(s => (s.id === next.id ? next : s)),
          }
        : v,
    )
    setCurrent((isNew ? view.slides.length + 1 : view.slides.length) - 1)
    watchImage(next)
  }

  const onSpeak = async (e: FormEvent) => {
    e.preventDefault()
    if (!phrase.trim() || busy) return
    setBusy(true)
    setSpeakError(null)
    try {
      const event = await dispatchAction<SlideEvent>('session.phrase', {
        deckId: view.deck.id,
        phrase: phrase.trim(),
      })
      applyEvent(event)
      setPhrase('')
      inputRef.current?.focus()
    } catch {
      setSpeakError('Generation failed — try again')
    } finally {
      setBusy(false)
    }
  }

  /** In-place edits (EDIT-1) persist through the action layer. */
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

  /** Renames the lecture through the action layer (owner only). */
  const renameDeck = (title: string) => {
    dispatchAction<Deck>('deck.rename', { deckId: view.deck.id, title })
      .then(deck => setView(v => (v ? { ...v, deck } : v)))
      .catch(() => {
        // Quiet failure: the title reverts to the saved value
      })
  }

  /** Appends a starter slide at the end and navigates to it. */
  const addSlide = async () => {
    try {
      const nextIndex = view.slides.length
      const added = await dispatchAction<Slide>('slide.add', {
        deckId: view.deck.id,
      })
      setView(v =>
        v
          ? {
              ...v,
              deck: { ...v.deck, slideOrder: [...v.deck.slideOrder, added.id] },
              slides: [...v.slides, added],
            }
          : v,
      )
      nav.setCurrent(nextIndex)
    } catch {
      // Quiet failure
    }
  }

  /** Persists a new slide order optimistically, reverting on failure. */
  const applyOrder = (ids: string[]) => {
    const previous = view.slides
    const byId = new Map(view.slides.map(s => [s.id, s]))
    setView(v =>
      v
        ? {
            ...v,
            deck: { ...v.deck, slideOrder: ids },
            slides: ids.map((id, i) => ({ ...byId.get(id)!, index: i })),
          }
        : v,
    )
    dispatchAction<Deck>('deck.reorderSlides', {
      deckId: view.deck.id,
      slideOrder: ids,
    }).catch(() => {
      setView(v =>
        v
          ? {
              ...v,
              deck: { ...v.deck, slideOrder: previous.map(s => s.id) },
              slides: previous,
            }
          : v,
      )
    })
  }

  /** Drag drop: move the dragged slide to the target row's position. */
  const moveSlideTo = (sourceId: string, targetIndex: number) => {
    const ids = view.slides.map(s => s.id)
    const from = ids.indexOf(sourceId)
    if (from < 0 || from === targetIndex) return
    ids.splice(from, 1)
    ids.splice(targetIndex, 0, sourceId)
    applyOrder(ids)
  }

  /** Keyboard path on the handle: move a slide one step up or down. */
  const moveSlideBy = (sourceId: string, delta: -1 | 1) => {
    const from = view.slides.findIndex(s => s.id === sourceId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= view.slides.length) return
    moveSlideTo(sourceId, to)
  }

  /** Removes a slide via slide.delete and drops it from the local view. */
  const deleteSlide = async (slideId: string) => {
    try {
      await dispatchAction('slide.delete', { slideId })
      setView(v =>
        v
          ? {
              ...v,
              deck: {
                ...v.deck,
                slideOrder: v.deck.slideOrder.filter(id => id !== slideId),
              },
              slides: v.slides
                .filter(s => s.id !== slideId)
                .map((s, i) => ({ ...s, index: i })),
            }
          : v,
      )
      nav.setCurrent(c => Math.max(0, Math.min(c, view.slides.length - 2)))
    } catch {
      // Quiet failure: the slide simply stays
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6">
      <DeckPageHeader
        mode={mode}
        onModeChange={setMode}
        title={
          isOwner ? (
            <EditableText
              value={view.deck.title}
              label="Lecture title"
              onSave={renameDeck}
            />
          ) : (
            view.deck.title
          )
        }
        actions={
          isOwner && (
            <>
              <button
                aria-label="Lecture settings"
                title="Lecture settings"
                onClick={() => setSettingsOpen(true)}
                className="rounded-md p-2 text-slate-500 hover:text-slate-900"
              >
                <Settings className="h-5 w-5" aria-hidden />
              </button>
              <button
                aria-label="Add slide"
                title="Add a slide at the end"
                onClick={() => void addSlide()}
                className="rounded-md p-2 text-slate-500 hover:text-slate-900"
              >
                <Plus className="h-5 w-5" aria-hidden />
              </button>
              <button
                aria-label="Live session"
                title="Speak to add slides"
                aria-pressed={speaking}
                onClick={() => setSpeaking(s => !s)}
                className={`rounded-md p-2 ${
                  speaking
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Mic className="h-5 w-5" aria-hidden />
              </button>
            </>
          )
        }
      />

      {view.slides.length === 0 ? (
        <p className="text-center text-slate-400">This deck has no slides.</p>
      ) : mode === 'carousel' ? (
        <>
          <div className="w-full flex-1">
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
                imagePending={pendingImages.has(slide!.id)}
              />
              {isOwner && (
                <SlideDeleteButton
                  label={`Delete slide ${nav.current + 1}`}
                  onDelete={() => void deleteSlide(slide!.id)}
                />
              )}
            </SlideNavZones>
          </div>
          <p className="mx-auto mt-4 text-sm text-slate-500">
            {nav.current + 1} / {view.slides.length}
          </p>
        </>
      ) : (
        <ul className="flex w-full flex-col gap-6">
          {view.slides.map((s, i) =>
            isOwner ? (
              <DraggableListRow
                key={s.id}
                id={s.id}
                index={i}
                handleLabel={`Reorder slide ${i + 1}`}
                onDropOn={moveSlideTo}
                onKeyMove={moveSlideBy}
                itemRef={nav.registerItem(i)}
              >
                <SlideView
                  slide={s}
                  template={view.template}
                  editable
                  onEdit={editSlide(s.id)}
                  imagePending={pendingImages.has(s.id)}
                />
                <SlideDeleteButton
                  label={`Delete slide ${i + 1}`}
                  onDelete={() => void deleteSlide(s.id)}
                />
              </DraggableListRow>
            ) : (
              <li key={s.id} ref={nav.registerItem(i)} className="relative">
                <SlideView slide={s} template={view.template} />
              </li>
            ),
          )}
        </ul>
      )}

      {isOwner && settingsOpen && (
        <DeckSettingsModal
          deck={view.deck}
          onClose={() => setSettingsOpen(false)}
          onTemplateChange={(deck, template) =>
            setView(v => (v ? { ...v, deck, template } : v))
          }
        />
      )}

      {isOwner && speaking && (
        <>
          <form
            onSubmit={onSpeak}
            aria-label="Live session"
            className="mt-6 flex w-full gap-2"
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
          {speakError && (
            <p role="alert" className="mt-2 w-full text-sm text-red-600">
              {speakError}
            </p>
          )}
        </>
      )}
    </div>
  )
}
