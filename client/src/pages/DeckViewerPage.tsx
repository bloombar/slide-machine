/**
 * Public deck viewer reached by permalink (SHARE-1). Playback (PLAY-1)
 * and the carousel/list switch come from the shared slide-navigation
 * codebase (useSlideNavigation + SlideNavZones + ViewModeToggle). The
 * deck's owner also gets a "Resume lecture" affordance — ending a
 * session never closes it (CAP-1).
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Mic, Plus } from 'lucide-react'
import type { Deck, DeckViewResponse, Slide } from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { dispatchAction } from '../api/actions'
import { useAuth } from '../auth/AuthContext'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import SlideView, { type SlideTextPatch } from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import SlideDeleteButton from '../components/SlideDeleteButton'
import DraggableListRow from '../components/DraggableListRow'
import EditableText from '../components/EditableText'
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
      const slide = await dispatchAction<Slide>('slide.add', {
        deckId: view.deck.id,
      })
      setView(v =>
        v
          ? {
              ...v,
              deck: {
                ...v.deck,
                slideOrder: [...v.deck.slideOrder, slide.id],
              },
              slides: [...v.slides, slide],
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
                aria-label="Add slide"
                onClick={() => void addSlide()}
                className="rounded-md p-2 text-slate-500 hover:text-slate-900"
              >
                <Plus className="h-5 w-5" aria-hidden />
              </button>
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
        <ul className="mx-auto flex w-full max-w-4xl flex-col gap-6">
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
    </div>
  )
}
