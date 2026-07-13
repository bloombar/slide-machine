/**
 * Deck viewer reached by permalink (SHARE-1) — and, for the deck's
 * owner, the single surface for everything: in-place text editing,
 * adding/deleting/reordering slides, and the live session. The
 * microphone icon toggles the (typed, until STT lands) "Speak" bar,
 * whose phrases flow through session.phrase exactly as the streamed
 * pipeline will (GEN-1/CAP-1). Playback and the carousel/list switch
 * come from the shared slide-navigation codebase.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
import { useTimeAgo } from '../hooks/useTimeAgo'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import { createSpeechCapture } from '../stt/capture'
import {
  COMMAND_LABELS,
  matchVoiceCommand,
  type VoiceCommand,
} from '../stt/commands'
import SlideView, { type SlideContentPatch } from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import SlideMenu from '../components/SlideMenu'
import LayoutPickerModal from '../components/LayoutPickerModal'
import DraggableListRow from '../components/DraggableListRow'
import EditableText from '../components/EditableText'
import DeckPageHeader from '../components/DeckPageHeader'
import DeckSettingsModal, {
  type SettingsTabId,
} from '../components/DeckSettingsModal'
import { ShellTitle } from '../components/layout/ShellTitle'
import { type ViewMode } from '../components/ViewModeToggle'
import { lectureTitle, UNTITLED } from '../lib/lecture'

/** Slide count and modification age, small beside the title in the nav. */
function DeckTitleMeta({ deck, count }: { deck: Deck; count: number }) {
  const age = useTimeAgo(deck.updatedAt)
  return (
    <span className="whitespace-nowrap text-xs font-normal text-slate-500">
      {count} slide{count === 1 ? '' : 's'} · edited {age}
    </span>
  )
}

export default function DeckViewerPage() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, status } = useAuth()
  const [view, setView] = useState<DeckViewResponse | null>(null)
  // Always-fresh view for callbacks that outlive their render (the mic
  // queue submits phrases from closures captured when listening began)
  const viewRef = useRef<DeckViewResponse | null>(null)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const [mode, setMode] = useState<ViewMode>('carousel')
  const [error, setError] = useState<string | null>(null)
  // A lecture list's Share option deep-links to the sharing tab; the
  // layout picker's "Change template" link deep-links to the design tab
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(
    () =>
      (location.state as { settingsTab?: SettingsTabId } | null)?.settingsTab ??
      null,
  )
  const [settingsOpen, setSettingsOpen] = useState(() => settingsTab !== null)
  // Which slide the layout picker is open for (EDIT-3)
  const [layoutPickerFor, setLayoutPickerFor] = useState<string | null>(null)
  // Blank slots are invisible to the audience; clicking the page
  // background flashes a half-second skeleton reveal so editors can
  // find them
  const [revealBlanks, setRevealBlanks] = useState(false)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [speaking, setSpeaking] = useState<boolean>(() =>
    Boolean(
      (location.state as { startSpeaking?: boolean } | null)?.startSpeaking,
    ),
  )
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [speakError, setSpeakError] = useState<string | null>(null)
  const capture = useMemo(() => createSpeechCapture(), [])
  // Entering via "Start a new lecture" opens the bar AND the microphone
  const [listening, setListening] = useState<boolean>(
    () =>
      Boolean(
        (location.state as { startSpeaking?: boolean } | null)?.startSpeaking,
      ) && capture.available,
  )
  const [interim, setInterim] = useState('')
  // Finalized phrases submit sequentially so rolling context stays sane
  const phraseQueueRef = useRef<Promise<void>>(Promise.resolve())
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

  // Leaving the page stops the microphone
  useEffect(() => {
    return () => capture.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Start lecture" hands over with startSpeaking in router state (read
  // by the lazy initializer above); scrub it so a reload doesn't re-open
  // the mic — history.state survives reloads
  useEffect(() => {
    const state = location.state as {
      startSpeaking?: boolean
      settingsTab?: string
    } | null
    if (state?.startSpeaking || state?.settingsTab) {
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /**
   * Stamps the deck as edited right now, mirroring the server-side
   * touch, so the "edited <age>" nav metadata updates in real time
   * after every auto-save.
   */
  const touchDeckLocally = () => {
    setView(v =>
      v
        ? { ...v, deck: { ...v.deck, updatedAt: new Date().toISOString() } }
        : v,
    )
  }

  /** Applies a generation event: new slides append, updates replace —
   * and the view always transitions to the slide that changed. */
  const applyEvent = (event: SlideEvent) => {
    // AI-recognized command intent (feature-flagged server-side):
    // execute exactly as if the wake-worded phrase had matched locally
    if (event.kind === 'command') {
      if (event.command) runVoiceCommand(event.command)
      return
    }
    if (event.kind === 'none' || !event.slide) return
    const next = event.slide
    const isNew = event.kind === 'slide.new'
    // Read through the ref, not the closure: mic-queued phrases arrive
    // long after the render that created this callback
    const slides = viewRef.current?.slides ?? []
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
    const target = isNew
      ? slides.length
      : slides.findIndex(s => s.id === next.id)
    setCurrent(Math.max(0, target))
    // List view: center the changed slide after it commits — the index
    // may be unchanged (updating the current slide), so the navigation
    // effect alone wouldn't re-scroll
    requestAnimationFrame(() => nav.scrollTo(Math.max(0, target)))
    touchDeckLocally()
    watchImage(next)
  }

  const submitPhrase = async (text: string) => {
    // Via the ref: mic phrases can arrive from long-lived callbacks
    const deckId = viewRef.current?.deck.id
    if (!deckId) return
    setBusy(true)
    setSpeakError(null)
    try {
      const event = await dispatchAction<SlideEvent>('session.phrase', {
        deckId,
        phrase: text,
        // Last fallback in the language cascade (lecture ?? project ??
        // profile ?? this) — only used when nothing is stored anywhere
        browserLanguage: navigator.language || undefined,
      })
      applyEvent(event)
    } catch {
      setSpeakError('Generation failed — try again')
    } finally {
      setBusy(false)
    }
  }

  const onSpeak = async (e: FormEvent) => {
    e.preventDefault()
    if (!phrase.trim() || busy) return
    await submitPhrase(phrase.trim())
    setPhrase('')
    inputRef.current?.focus()
  }

  const stopListening = () => {
    capture.stop()
    setListening(false)
    setInterim('')
  }

  /** Appends a starter slide at the end and navigates to it. Reads
   * through the ref: voice commands call this from stale closures. */
  const addSlide = async () => {
    const current = viewRef.current
    if (!current) return
    try {
      const nextIndex = current.slides.length
      const added = await dispatchAction<Slide>('slide.add', {
        deckId: current.deck.id,
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
      touchDeckLocally()
      nav.setCurrent(nextIndex)
    } catch {
      // Quiet failure
    }
  }

  /** Executes a wake-worded voice command (CAP-4). Navigation goes
   * through functional setCurrent so stale closures stay correct. */
  const runVoiceCommand = (command: VoiceCommand) => {
    if (command === 'next' || command === 'previous') {
      const delta = command === 'next' ? 1 : -1
      setCurrent(c => {
        const count = viewRef.current?.slides.length ?? 0
        const target = Math.max(0, Math.min(count - 1, c + delta))
        requestAnimationFrame(() => nav.scrollTo(target))
        return target
      })
    } else if (command === 'pause') {
      stopListening()
    } else if (command === 'newSlide') {
      void addSlide()
    }
    // Brief on-screen echo of the interpreted command
    setInterim(`✓ ${COMMAND_LABELS[command]}`)
    window.setTimeout(
      () => setInterim(prev => (prev.startsWith('✓') ? '' : prev)),
      1500,
    )
  }

  /** Attaches recognition; recognized phrases queue through the same
   * pipeline as typed ones — unless the phrase is a wake-worded
   * command, which acts immediately and never reaches generation. */
  const beginCapture = () => {
    capture.start(
      {
        onPhrase: text => {
          setInterim('')
          const command = matchVoiceCommand(text)
          if (command) {
            runVoiceCommand(command)
            return
          }
          phraseQueueRef.current = phraseQueueRef.current.then(() =>
            submitPhrase(text),
          )
        },
        onInterim: setInterim,
        onError: message => {
          setListening(false)
          setInterim('')
          setSpeakError(message)
        },
      },
      // Recognize speech in the resolved lecture language; undefined
      // leaves the browser's own language in charge
      viewRef.current?.effectiveLanguage,
    )
  }

  const startListening = () => {
    if (!capture.available) return
    setSpeakError(null)
    beginCapture()
    setListening(true)
  }

  // "Start a new lecture" auto-opens the mic: the bar and the listening
  // flag are already on (lazy init), so only the capture needs kicking —
  // once the view arrives, so recognition starts in the resolved
  // lecture language instead of the browser default
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (listening && view && !autoStartedRef.current) {
      autoStartedRef.current = true
      beginCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // A click on the page background — not the slide, a control, or a
  // modal backdrop — briefly reveals blank slots (styled in index.css),
  // which hide again on their own half a second later
  const canEditView = Boolean(view?.canEdit)
  useEffect(() => {
    if (!canEditView) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (
        target?.closest(
          'a, button, input, textarea, select, label, [role], [aria-hidden], [data-testid="slide"]',
        )
      )
        return
      setRevealBlanks(true)
      clearTimeout(revealTimerRef.current)
      revealTimerRef.current = setTimeout(() => setRevealBlanks(false), 500)
    }
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('click', onClick)
      clearTimeout(revealTimerRef.current)
    }
  }, [canEditView])

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
  const canEdit = view.canEdit

  /** Per-slide layout switch (EDIT-3): content stays, arrangement changes. */
  const setSlideLayout = (slideId: string, layoutType: string) => {
    dispatchAction<Slide>('slide.setLayout', { slideId, layoutType })
      .then(updated => {
        setView(v =>
          v
            ? {
                ...v,
                slides: v.slides.map(s => (s.id === updated.id ? updated : s)),
              }
            : v,
        )
        touchDeckLocally()
      })
      .catch(() => {
        // Quiet failure: the slide keeps its layout
      })
    setLayoutPickerFor(null)
  }

  /** In-place edits (EDIT-1) persist through the action layer. */
  const editSlide = (slideId: string) => (patch: SlideContentPatch) => {
    dispatchAction<Slide>('slide.editContent', { slideId, ...patch })
      .then(updated => {
        setView(v =>
          v
            ? {
                ...v,
                slides: v.slides.map(s => (s.id === updated.id ? updated : s)),
              }
            : v,
        )
        touchDeckLocally()
      })
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
    })
      .then(() => touchDeckLocally())
      .catch(() => {
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
      touchDeckLocally()
      nav.setCurrent(c => Math.max(0, Math.min(c, view.slides.length - 2)))
    } catch {
      // Quiet failure: the slide simply stays
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6"
      data-reveal-blanks={revealBlanks ? 'true' : undefined}
    >
      <ShellTitle>
        <h1 className="min-w-0 truncate">
          {canEdit ? (
            <EditableText
              value={view.deck.title}
              label="Lecture title"
              emptyDisplay={UNTITLED}
              onSave={renameDeck}
            />
          ) : (
            lectureTitle(view.deck)
          )}
        </h1>
        <DeckTitleMeta deck={view.deck} count={view.slides.length} />
      </ShellTitle>

      <DeckPageHeader
        mode={mode}
        onModeChange={setMode}
        actions={
          canEdit && (
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
                title={
                  listening
                    ? 'Recording — click to stop'
                    : 'Speak to add slides'
                }
                aria-pressed={speaking}
                onClick={() => {
                  // One toggle: the bar and the microphone together
                  if (speaking) stopListening()
                  else startListening()
                  setSpeaking(s => !s)
                }}
                className={`rounded-md p-2 ${
                  listening
                    ? 'animate-pulse bg-red-50 text-red-600'
                    : speaking
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
        canEdit ? (
          <p className="text-center text-slate-400">
            Click the{' '}
            <Plus
              className="inline h-4 w-4 align-text-bottom"
              aria-label="plus"
            />{' '}
            or{' '}
            <Mic
              className="inline h-4 w-4 align-text-bottom"
              aria-label="microphone"
            />{' '}
            icons to start adding content.
          </p>
        ) : (
          <p className="text-center text-slate-400">This deck has no slides.</p>
        )
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
                editable={canEdit}
                onEdit={editSlide(slide!.id)}
                imagePending={pendingImages.has(slide!.id)}
              />
              {canEdit && (
                <SlideMenu
                  number={nav.current + 1}
                  onChangeLayout={() => setLayoutPickerFor(slide!.id)}
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
            canEdit ? (
              <DraggableListRow
                key={s.id}
                id={s.id}
                index={i}
                label={`Slide ${i + 1}`}
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
                <SlideMenu
                  number={i + 1}
                  onChangeLayout={() => setLayoutPickerFor(s.id)}
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

      {canEdit && layoutPickerFor && (
        <LayoutPickerModal
          template={view.template}
          current={
            view.slides.find(s => s.id === layoutPickerFor)?.layoutType ?? ''
          }
          onPick={layoutType => setSlideLayout(layoutPickerFor, layoutType)}
          onClose={() => setLayoutPickerFor(null)}
          onChangeTemplate={() => {
            setLayoutPickerFor(null)
            setSettingsTab('template')
            setSettingsOpen(true)
          }}
        />
      )}

      {canEdit && settingsOpen && (
        <DeckSettingsModal
          deck={view.deck}
          projectGenerationFreedom={view.projectGenerationFreedom}
          initialTab={settingsTab ?? 'general'}
          isOwner={isOwner}
          onClose={() => setSettingsOpen(false)}
          onDeckChange={deck => setView(v => (v ? { ...v, deck } : v))}
          onDeleted={() => void navigate('/app')}
          onTemplateChange={(deck, template) =>
            setView(v => (v ? { ...v, deck, template } : v))
          }
        />
      )}

      {canEdit && speaking && (
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
              placeholder={
                listening
                  ? 'Listening… (you can still type)'
                  : 'Say something about your topic…'
              }
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
          {interim && (
            <p
              aria-live="polite"
              className="mt-2 w-full text-sm text-slate-400 italic"
            >
              {interim}
            </p>
          )}
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
