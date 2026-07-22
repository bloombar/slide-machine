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
import {
  Mic,
  Pause,
  Play,
  Plus,
  Settings,
  Share,
  UploadCloud,
} from 'lucide-react'
import type {
  Deck,
  DeckRefineSlideResult,
  DeckViewResponse,
  ImageSearchCandidate,
  Slide,
  SlideEvent,
  Stroke,
  StrokeAnchor,
  WordTiming,
} from '@slide-machine/shared'
import { strokeVisible } from '../lib/drawing'
import { apiFetch, ApiError } from '../api/http'
import { dispatchAction } from '../api/actions'
import {
  applySlideImageFromSource,
  editSlideDrawings,
  fetchSlideOriginalAudioUrl,
  pollSlideImage,
  uploadSlideImage,
} from '../api/slides'
import { useAuth } from '../auth/AuthContext'
import { useTimeAgo } from '../hooks/useTimeAgo'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import { useBracketKeys } from '../hooks/useBracketKeys'
import { useSpaceKey } from '../hooks/useSpaceKey'
import { useUndoRedoKeys } from '../hooks/useUndoRedoKeys'
import { createSpeechCapture, type PhraseMeta } from '../stt/capture'
import {
  COMMAND_LABELS,
  matchVoiceCommand,
  type VoiceCommand,
} from '../stt/commands'
import SlideView, { type SlideContentPatch } from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import SlideMenu from '../components/SlideMenu'
import { useTtsPlayback } from '../tts/playback'
import {
  getSttEngine,
  getTtsEnabled,
  getWhiteboardSuppressDebounceMs,
} from '../runtime-config'
import LayoutPickerModal from '../components/LayoutPickerModal'
import DraggableListRow from '../components/DraggableListRow'
import EditableText from '../components/EditableText'
import DeckPageHeader from '../components/DeckPageHeader'
import WhiteboardToolbar from '../components/whiteboard/WhiteboardToolbar'
import DrawingLayer from '../components/whiteboard/DrawingLayer'
import { useWhiteboard } from '../components/whiteboard/useWhiteboard'
import { themeColors } from '../components/slide/theme'
import Tooltip from '../components/Tooltip'
import SeedDialog from '../components/SeedDialog'
import DeckSettingsModal, {
  type SettingsTabId,
} from '../components/DeckSettingsModal'
import { ShellTitle } from '../components/layout/ShellTitle'
import { ShellActions } from '../components/layout/ShellActions'
import ViewModeToggle, { type ViewMode } from '../components/ViewModeToggle'
import { lectureTitle, UNTITLED } from '../lib/lecture'

// The toolbar's "Seed material" upload button is hidden for now but its
// wiring (openManualSeed, the SeedDialog) is kept so it can return by
// flipping this to true — seeding still happens from the pre-lecture
// dialog and Lecture settings in the meantime.
const SHOW_SEED_UPLOAD_IN_TOOLBAR = false

// Carousel/list is a display preference, remembered across reloads so a
// refresh keeps whichever view the user was reading in
const VIEW_MODE_KEY = 'sm:view-mode'

const readViewMode = (): ViewMode => {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    return stored === 'list' || stored === 'carousel' ? stored : 'carousel'
  } catch {
    return 'carousel'
  }
}

const writeViewMode = (mode: ViewMode): void => {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // Storage unavailable (private browsing): the mode just won't persist
  }
}

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
  const [mode, setModeState] = useState<ViewMode>(readViewMode)
  const setMode = (next: ViewMode) => {
    setModeState(next)
    writeViewMode(next)
  }
  const [error, setError] = useState<string | null>(null)
  // A lecture list's Share option deep-links to the sharing tab; the
  // layout picker's "Change template" link deep-links to the design tab
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(() => {
    const fromState = (location.state as { settingsTab?: SettingsTabId } | null)
      ?.settingsTab
    if (fromState) return fromState
    // OAuth flows (e.g. Google connect for quizzes) return via a full page
    // load, which loses router state — they reopen the tab with a ?settings=
    // param instead. Only known tab ids are honored.
    const fromUrl = new URLSearchParams(window.location.search).get('settings')
    const known: SettingsTabId[] = [
      'general',
      'template',
      'refine',
      'quiz',
      'sharing',
    ]
    return fromUrl && known.includes(fromUrl as SettingsTabId)
      ? (fromUrl as SettingsTabId)
      : null
  })
  const [settingsOpen, setSettingsOpen] = useState(() => settingsTab !== null)

  // Strip the one-shot ?settings= param after using it, so a refresh doesn't
  // reopen the modal and the URL stays clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('settings')) {
      params.delete('settings')
      const qs = params.toString()
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (qs ? `?${qs}` : ''),
      )
    }
  }, [])
  // Which slide the layout picker is open for (EDIT-3)
  const [layoutPickerFor, setLayoutPickerFor] = useState<string | null>(null)
  // Blank slots are invisible to the audience; clicking the page
  // background flashes a half-second skeleton reveal so editors can
  // find them
  const [revealBlanks, setRevealBlanks] = useState(false)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // "Start a new lecture" hands over startSpeaking. Recording no longer
  // begins immediately: the pre-lecture seed dialog opens first, and the
  // bar and microphone start only when it is dismissed.
  const startRequested = Boolean(
    (location.state as { startSpeaking?: boolean } | null)?.startSpeaking,
  )
  const [speaking, setSpeaking] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [speakError, setSpeakError] = useState<string | null>(null)
  // Surfaced when a slide image upload/remove fails, so it is never silent
  const [imageError, setImageError] = useState<string | null>(null)
  const capture = useMemo(() => createSpeechCapture(), [])
  const [listening, setListening] = useState(false)
  // Seed dialog: 'prelecture' before recording begins, 'manual' from the
  // toolbar during the lecture, null when closed
  const [seedDialog, setSeedDialog] = useState<'prelecture' | 'manual' | null>(
    startRequested ? 'prelecture' : null,
  )
  // Whether a mid-lecture seed dialog should resume the mic on close
  const resumeAfterSeedRef = useRef(false)
  const [interim, setInterim] = useState('')
  // Finalized phrases submit sequentially so rolling context stays sane
  const phraseQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [pendingImages, setPendingImages] = useState<Set<string>>(new Set())
  // The slide currently being refined via its kebab (drives a status toast)
  const [refiningSlideId, setRefiningSlideId] = useState<string | null>(null)
  // Original-audio playback (kebab "Play original audio"): the slide currently
  // playing, plus the <audio> element and its blob URL to revoke afterwards.
  const [playingOriginalId, setPlayingOriginalId] = useState<string | null>(
    null,
  )
  const originalAudioRef = useRef<HTMLAudioElement | null>(null)
  const originalUrlRef = useRef<string | null>(null)

  // Whiteboard drawing (WB-1): active tool + per-tool color/thickness. Default
  // colors come from the deck's design template so marks suit the slides (WB-1).
  const templateColors = view ? themeColors(view.template.theme) : undefined
  const whiteboard = useWhiteboard({
    penColor: templateColors?.penColor,
    highlighterColor: templateColors?.highlighterColor,
  })
  // Wall-clock of the last drawing/erasing gesture (WB-3): while the user is
  // actively marking up a slide — including a debounce grace after the last
  // gesture so switching tools or repositioning still counts — speech folds
  // into the current slide instead of spawning a new one.
  const lastDrawActivityRef = useRef<number | null>(null)
  const noteDrawActivity = () => {
    lastDrawActivityRef.current = Date.now()
  }
  /** True while the user is actively marking up a slide (within the debounce
   * grace after the last gesture). */
  const isActivelyDrawing = (): boolean => {
    const last = lastDrawActivityRef.current
    return last != null && Date.now() - last < getWhiteboardSuppressDebounceMs()
  }
  // Anchoring (WB-2): wall-clock when recording began, and the latest phrase
  // (with word timings) per slide, so a stroke can be pinned to the transcript
  // position it was drawn at. Word timings exist for the google-cloud engine.
  const sessionStartWallRef = useRef<number | null>(null)
  const lastPhraseBySlideRef = useRef<
    Record<string, { phrase: string; words?: WordTiming[]; sessionId?: string }>
  >({})
  // Debounce timers for persisting each slide's drawings after edits.
  const drawingsSaveTimers = useRef<Record<string, number>>({})
  // Per-slide whiteboard undo/redo history (Cmd/Ctrl-Z). Each entry keeps
  // snapshots of that slide's `drawings` array before every mark, so undo/redo
  // only ever affect the slide being drawn on — never text or other slides.
  const drawingHistory = useRef<
    Record<string, { undo: Stroke[][]; redo: Stroke[][] }>
  >({})
  useEffect(
    () => () => {
      originalAudioRef.current?.pause()
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current)
    },
    [],
  )
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
        // Switching onto an image layout sources an image server-side; the
        // returned slide carries the search intent, so poll for it to land.
        watchImage(updated)
        touchDeckLocally()
      })
      .catch(() => {
        // Quiet failure: the slide keeps its layout
      })
    setLayoutPickerFor(null)
  }

  /**
   * Steps the active slide through the template's layouts (EDIT-3) via
   * the "[" / "]" keys. The active slide is the displayed one in carousel
   * view; in list view it's whichever slide is actually on screen — never
   * a stale off-screen `current` after the user has scrolled away. Wraps
   * around and is a no-op unless the viewer can edit.
   */
  const cycleLayout = (direction: 1 | -1) => {
    const v = viewRef.current
    if (!v?.canEdit) return
    const layouts = v.template.layouts
    if (layouts.length < 2) return
    const index = mode === 'carousel' ? nav.current : nav.visibleIndex()
    if (index == null) return
    const target = v.slides[index]
    if (!target) return
    const at = layouts.findIndex(l => l.type === target.layoutType)
    const next = layouts[(at + direction + layouts.length) % layouts.length]
    if (!next || next.type === target.layoutType) return
    setSlideLayout(target.id, next.type)
  }
  useBracketKeys(
    () => cycleLayout(-1),
    () => cycleLayout(1),
  )

  /** Applies a generation event: new slides append, updates replace —
   * and the view always transitions to the slide that changed. */
  const applyEvent = (event: SlideEvent) => {
    // The AI titled the (previously untitled) lecture — reflect it in
    // the header; the server has already saved it
    if (event.deckTitle) {
      const title = event.deckTitle
      setView(v => (v ? { ...v, deck: { ...v.deck, title } } : v))
    }
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
              : // session.phrase only changes content/transcript, never
                // whiteboard drawings — those are saved on a separate debounced
                // path (slide.editDrawings). The phrase response carries a
                // possibly-stale drawings array, so keep the LOCAL drawings
                // (which include just-drawn, not-yet-saved strokes) to avoid
                // clobbering them mid-draw (WB-1).
                v.slides.map(s =>
                  s.id === next.id ? { ...next, drawings: s.drawings } : s,
                ),
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

  const submitPhrase = async (text: string, meta?: PhraseMeta) => {
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
        // Diarization groundwork (GEN-4): carry the recording session id and
        // any word timings/confidence through to the stored transcript
        // segment. Absent for typed input (no audio).
        ...(meta?.sessionId ? { sessionId: meta.sessionId } : {}),
        ...(typeof meta?.confidence === 'number'
          ? { confidence: meta.confidence }
          : {}),
        ...(meta?.words?.length ? { words: meta.words } : {}),
        // Actively drawing (within the debounce grace) folds the phrase into
        // the current slide instead of spawning one (WB-3). The "+" button and
        // the "new slide" voice command bypass this path and still create.
        ...(isActivelyDrawing() ? { suppressNewSlide: true } : {}),
      })
      applyEvent(event)
      // Remember this phrase against the slide it landed on, with any word
      // timings, so a stroke drawn now can be anchored to the transcript (WB-2).
      if (event.slide?.id) {
        lastPhraseBySlideRef.current[event.slide.id] = {
          phrase: text,
          words: meta?.words,
          sessionId: meta?.sessionId,
        }
      }
    } catch (err) {
      // Show the server's message when generation is unavailable (quota/
      // credits exhausted or the provider is overloaded); otherwise a
      // generic retry prompt.
      setSpeakError(
        err instanceof ApiError && err.code === 'generation_unavailable'
          ? err.message
          : 'Generation failed — try again',
      )
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
    // Ending a google-cloud recording makes the server flush its audio to
    // storage and attach it to the deck — asynchronously, on socket close. The
    // deck view computed audioSlideIds at load, so poll it for a short window
    // to reveal the per-slide "Play original audio" option without a reload.
    if (getSttEngine() === 'google-cloud') refreshAudioAvailability()
  }

  /** Polls the deck view until new retained audio appears (or the window
   * elapses), merging only audioSlideIds so local slide state is untouched. */
  const refreshAudioAvailability = () => {
    const had = new Set(viewRef.current?.audioSlideIds ?? [])
    let tries = 0
    const poll = () => {
      tries++
      apiFetch<DeckViewResponse>(`/api/decks/${slug}`)
        .then(fresh => {
          const ids = fresh.audioSlideIds ?? []
          setView(v => (v ? { ...v, audioSlideIds: ids } : v))
          const grew = ids.some(id => !had.has(id))
          if (!grew && tries < 24) window.setTimeout(poll, 5000)
        })
        .catch(() => {
          if (tries < 24) window.setTimeout(poll, 5000)
        })
    }
    // Give the flush (concat → WAV → upload) a moment to begin before the first
    // check; a large lecture can take a while, so keep polling up to ~2 min.
    window.setTimeout(poll, 3000)
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

  /** The lecture language in effect right now, resolved client-side so
   * mid-session settings changes take hold: lecture ?? project ??
   * speaker profile; undefined = the browser's own language. */
  const sttLanguage = () => {
    const v = viewRef.current
    return v?.deck.language ?? v?.projectLanguage ?? user?.language
  }

  /** Attaches recognition; recognized phrases queue through the same
   * pipeline as typed ones — unless the phrase is a wake-worded
   * command, which acts immediately and never reaches generation. */
  const beginCapture = () => {
    capture.start(
      {
        onPhrase: (text, meta) => {
          setInterim('')
          const command = matchVoiceCommand(text)
          if (command) {
            runVoiceCommand(command)
            return
          }
          phraseQueueRef.current = phraseQueueRef.current.then(() =>
            submitPhrase(text, meta),
          )
        },
        onInterim: setInterim,
        onError: message => {
          setListening(false)
          setInterim('')
          setSpeakError(message)
        },
      },
      sttLanguage(),
      viewRef.current?.deck.id,
    )
  }

  const startListening = () => {
    if (!capture.available) return
    setSpeakError(null)
    // Mark the recording's wall-clock start so stroke draw-times can be turned
    // into session-relative ms and matched to word timings (WB-2).
    sessionStartWallRef.current = Date.now()
    beginCapture()
    setListening(true)
  }

  // Text-to-speech playback (TECH-8). Starting playback stops the mic first so
  // the app never records while it is speaking.
  const ttsEnabled = getTtsEnabled()
  const tts = useTtsPlayback({
    getSlides: () => viewRef.current?.slides ?? [],
    navigate: index => {
      setCurrent(index)
      requestAnimationFrame(() => nav.scrollTo(index))
    },
    stopMic: () => {
      if (speaking || listening) {
        stopListening()
        setSpeaking(false)
      }
    },
  })
  /** The slide the deck play button starts from: the active one per mode. */
  const activePlayIndex = (): number =>
    mode === 'carousel' ? nav.current : (nav.visibleIndex() ?? nav.current)
  const deckPlaying = tts.scope === 'deck' && tts.status === 'playing'
  /** Speaks a slide's content (kebab option), stopping any current playback. */
  const speakSlide = (slide: Slide) => tts.speakSlide(slide)
  // Space toggles deck narration play/pause, matching the toolbar button —
  // active only when TTS is on and the deck has slides to play.
  useSpaceKey(
    () => tts.toggle(activePlayIndex()),
    ttsEnabled && (view?.slides.length ?? 0) > 0,
  )

  // --- Whiteboard drawing state (WB-1/WB-2) ---
  // Defined above the early returns so undo/redo (below) and its keyboard hook
  // are declared unconditionally (Rules of Hooks). None dereference the
  // non-null `view` local — they go through setView/viewRef.

  /** Replaces the slide in the local view with a freshly-returned one. */
  const applySlide = (updated: Slide) => {
    setView(v =>
      v
        ? {
            ...v,
            slides: v.slides.map(s => (s.id === updated.id ? updated : s)),
          }
        : v,
    )
    touchDeckLocally()
  }

  /** Persists a slide's drawings (debounced), then patches in the saved copy. */
  const persistDrawings = (slideId: string, drawings: Stroke[]) => {
    const timers = drawingsSaveTimers.current
    if (timers[slideId]) window.clearTimeout(timers[slideId])
    timers[slideId] = window.setTimeout(() => {
      delete timers[slideId]
      editSlideDrawings(slideId, drawings)
        .then(applySlide)
        .catch(() => {
          // Quiet: the on-screen drawing stays; a later edit retries the save.
        })
    }, 600)
  }

  /** Applies a change to one slide's drawings locally and schedules a save. */
  const updateDrawings = (
    slideId: string,
    updater: (prev: Stroke[]) => Stroke[],
  ) => {
    setView(v => {
      if (!v) return v
      let next: Stroke[] | undefined
      const slides = v.slides.map(s => {
        if (s.id !== slideId) return s
        next = updater(s.drawings ?? [])
        return { ...s, drawings: next }
      })
      if (next) persistDrawings(slideId, next)
      return { ...v, slides }
    })
    touchDeckLocally()
  }

  // --- Whiteboard undo/redo (Cmd/Ctrl-Z, Cmd-Shift-Z, Ctrl-Y) ---

  /** A slide's current drawings, read fresh through the ref. */
  const currentDrawings = (slideId: string): Stroke[] =>
    viewRef.current?.slides.find(s => s.id === slideId)?.drawings ?? []

  /**
   * Snapshots a slide's drawings before a whiteboard mark so it can be undone
   * (Cmd/Ctrl-Z). Recording a fresh mark clears the redo stack — the usual
   * undo-history behavior: a new edit forks history.
   */
  const recordDrawingHistory = (slideId: string) => {
    const entry = drawingHistory.current[slideId] ?? { undo: [], redo: [] }
    entry.undo.push(currentDrawings(slideId))
    entry.redo = []
    drawingHistory.current[slideId] = entry
  }

  /** The slide the whiteboard is editing right now: the displayed slide in
   * carousel view, the one nearest the viewport center in list view. Undo/redo
   * act on this slide alone (never text or an off-screen slide). */
  const activeWhiteboardSlideId = (): string | undefined => {
    const idx =
      mode === 'carousel' ? nav.current : (nav.visibleIndex() ?? nav.current)
    return viewRef.current?.slides[idx]?.id
  }

  /** Undoes the last whiteboard mark on the active slide; true if it did. */
  const undoDrawing = (): boolean => {
    const slideId = activeWhiteboardSlideId()
    if (!slideId) return false
    const entry = drawingHistory.current[slideId]
    if (!entry?.undo.length) return false
    entry.redo.push(currentDrawings(slideId))
    const prev = entry.undo.pop()!
    updateDrawings(slideId, () => prev)
    return true
  }

  /** Redoes the last undone whiteboard mark on the active slide; true if it did. */
  const redoDrawing = (): boolean => {
    const slideId = activeWhiteboardSlideId()
    if (!slideId) return false
    const entry = drawingHistory.current[slideId]
    if (!entry?.redo.length) return false
    entry.undo.push(currentDrawings(slideId))
    const next = entry.redo.pop()!
    updateDrawings(slideId, () => next)
    return true
  }

  // Enabled whenever the deck is editable and has slides to draw on; an empty
  // history is a no-op that leaves the browser's native Cmd-Z untouched.
  useUndoRedoKeys(
    undoDrawing,
    redoDrawing,
    Boolean(view?.canEdit) && (view?.slides.length ?? 0) > 0,
  )

  // A voice-setting change should be heard immediately. The server already
  // picks up the new voice on the next synthesis, but the audio now playing was
  // generated in the old voice — so re-trigger the current item instead of
  // waiting for the next slide.
  const deckVoice = view?.deck.ttsVoice
  const lastVoiceRef = useRef(deckVoice)
  useEffect(() => {
    if (lastVoiceRef.current === deckVoice) return
    lastVoiceRef.current = deckVoice
    if (tts.status === 'idle') return // the next play already uses the new voice
    const index = tts.activeIndex ?? activePlayIndex()
    if (tts.scope === 'deck') tts.playDeck(index)
    else {
      const slide = viewRef.current?.slides[index]
      if (slide) tts.speakSlide(slide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckVoice])

  // Settings is an aside, not part of the lecture: talking through it
  // must never reach generation. Opening pauses capture; closing resumes
  // it only when it was actually recording beforehand.
  const resumeAfterSettingsRef = useRef(false)

  /** Opens lecture settings, pausing the microphone while it is up. */
  const openSettings = (tab?: SettingsTabId) => {
    resumeAfterSettingsRef.current = listening
    if (listening) stopListening()
    if (tab) setSettingsTab(tab)
    setSettingsOpen(true)
  }

  /** Closes lecture settings, resuming the microphone if it was paused. */
  const closeSettings = () => {
    setSettingsOpen(false)
    if (resumeAfterSettingsRef.current) {
      resumeAfterSettingsRef.current = false
      startListening()
    }
  }

  /** Opens the seed dialog mid-lecture, pausing the mic like settings does. */
  const openManualSeed = () => {
    resumeAfterSeedRef.current = listening
    if (listening) stopListening()
    setSeedDialog('manual')
  }

  /**
   * Closes the seed dialog. Dismissing the pre-lecture dialog (Skip or
   * Start lecture) is what actually begins the lecture — the bar opens and
   * the mic starts; the mid-lecture dialog just resumes if it was
   * recording. Runs once the view exists, so recognition starts in the
   * resolved lecture language rather than the browser default.
   */
  const closeSeed = () => {
    const mode = seedDialog
    setSeedDialog(null)
    if (mode === 'prelecture') {
      setSpeaking(true)
      startListening()
    } else if (resumeAfterSeedRef.current) {
      resumeAfterSeedRef.current = false
      startListening()
    }
  }

  // Switching the lecture language mid-recording: recognition holds its
  // language for the life of the instance, so restart it with the new
  // one. Only while listening, and only on an actual change.
  const activeLanguage =
    view?.deck.language ?? view?.projectLanguage ?? user?.language
  const prevLanguageRef = useRef(activeLanguage)
  useEffect(() => {
    if (prevLanguageRef.current === activeLanguage) return
    prevLanguageRef.current = activeLanguage
    if (!listening) return
    capture.stop()
    beginCapture()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLanguage, listening])

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

  // --- Whiteboard drawing (WB-1/WB-2) ---

  /**
   * Builds a stroke's transcript timing anchor for a draw/erase event on a
   * slide (WB-2). The durable value is a character offset into the slide's
   * narration; word timings (google-cloud) sharpen it to a position inside the
   * latest phrase, otherwise it pins to the end of the transcript so far.
   */
  const buildAnchor = (slideId: string, atWallMs: number): StrokeAnchor => {
    const slide = viewRef.current?.slides.find(s => s.id === slideId)
    const len = slide?.sourceTranscript?.length ?? 0
    // Mic off: the mark can't be tied to spoken words, so it's unsynced (WB-2)
    // — always shown on its slide, in or out of playback, so flipping to that
    // slide always reveals it. charAnchor 0 keeps it ordered at the start.
    if (!listening) return { charAnchor: 0, source: 'unsynced' }
    const info = lastPhraseBySlideRef.current[slideId]
    const start = sessionStartWallRef.current
    if (info?.words?.length && start != null) {
      const drawMs = atWallMs - start
      let best = info.words[0]!
      let bestDiff = Infinity
      for (const w of info.words) {
        const diff = Math.abs(w.startMs - drawMs)
        if (diff < bestDiff) {
          bestDiff = diff
          best = w
        }
      }
      // Where the latest phrase starts within the transcript, plus the nearest
      // word's offset inside it.
      const phraseStart = Math.max(0, len - info.phrase.length)
      const wordIdx = info.phrase.toLowerCase().indexOf(best.word.toLowerCase())
      return {
        charAnchor: phraseStart + (wordIdx >= 0 ? wordIdx : 0),
        source: 'word',
        sessionId: info.sessionId,
        sessionMs: drawMs,
      }
    }
    return { charAnchor: len, source: 'appended' }
  }

  const onCommitStroke = (slideId: string, stroke: Stroke) => {
    recordDrawingHistory(slideId)
    updateDrawings(slideId, prev => [...prev, stroke])
  }

  /** Whole-stroke erase as a timestamped event: the stroke is kept and stamped
   * with an erase anchor so playback can replay its removal (WB-2). */
  const onEraseStroke = (
    slideId: string,
    strokeId: string,
    anchor: StrokeAnchor,
  ) => {
    recordDrawingHistory(slideId)
    updateDrawings(slideId, prev =>
      prev.map(s =>
        s.id === strokeId && !s.erasedAnchor
          ? { ...s, erasedAnchor: anchor, erasedAt: new Date().toISOString() }
          : s,
      ),
    )
  }

  /** Playback visibility for a stroke (WB-2): reveal by its draw anchor and
   * hide again at its erase anchor, in step with the audio position — but
   * unsynced (mic-off) marks always show. Delegates to the pure `strokeVisible`. */
  const revealStroke = (slideId: string, stroke: Stroke): boolean => {
    const slides = viewRef.current?.slides ?? []
    const idx = slides.findIndex(s => s.id === slideId)
    const len = slides[idx]?.sourceTranscript?.length ?? 0
    return strokeVisible(stroke, idx, len, tts.getProgress())
  }

  // Saved strokes per slide, plus the shared DrawingLayer props (carousel +
  // list). Placed after the handlers above so it can reference them.
  const strokesById: Record<string, Stroke[]> = {}
  for (const s of view.slides)
    if (s.drawings?.length) strokesById[s.id] = s.drawings
  const drawingLayerProps = {
    tool: whiteboard.tool,
    penStyle: whiteboard.penStyle,
    highlighterStyle: whiteboard.highlighterStyle,
    strokesById,
    isPlaying: tts.status === 'playing',
    reveal: revealStroke,
    buildAnchor,
    onCommitStroke,
    onEraseStroke,
    onActivity: noteDrawActivity,
  }

  /** Uploads a file to replace (or set) a slide's image (EDIT-1). */
  const replaceSlideImage = (slideId: string) => (file: File) => {
    setImageError(null)
    uploadSlideImage(slideId, file)
      .then(applySlide)
      .catch(() => setImageError('Could not upload the image — try again'))
  }

  /** Applies a chosen web-search image to a slide (EDIT-1). */
  const pickSlideImageCandidate =
    (slideId: string) => (candidate: ImageSearchCandidate) => {
      setImageError(null)
      applySlideImageFromSource(slideId, candidate.url, candidate.attribution)
        .then(applySlide)
        .catch(() => setImageError('Could not set that image — try again'))
    }

  /**
   * Removes a slide's image, keeping the slide's layout unchanged so the
   * image slot simply becomes empty (an editor can drop a new image in). The
   * layout is deliberately NOT switched and the slide is never deleted — even
   * an image-only layout just shows its empty image slot.
   */
  const removeSlideImage = (target: Slide) => () => {
    dispatchAction<Slide>('slide.editContent', {
      slideId: target.id,
      imageRef: '',
    })
      .then(applySlide)
      .catch(() => setImageError('Could not remove the image — try again'))
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

  /** Refines one slide with the lecture's Refine settings, then patches it in
   * place. Runs synchronously (one slide is quick); a toast shows progress. */
  const refineSlide = async (slideId: string) => {
    setRefiningSlideId(slideId)
    setImageError(null)
    try {
      const res = await dispatchAction<DeckRefineSlideResult>(
        'deck.refineSlide',
        { deckId: view.deck.id, slideId },
      )
      setView(v =>
        v
          ? {
              ...v,
              slides: v.slides.map(s =>
                s.id === res.slide.id ? res.slide : s,
              ),
            }
          : v,
      )
      touchDeckLocally()
    } catch {
      setImageError('Could not refine that slide — try again')
    } finally {
      setRefiningSlideId(null)
    }
  }

  // The "Refine this slide" kebab item appears only when a slide-applicable
  // refine pass is enabled in the lecture's Refine settings (defaults on).
  const slideRefineEnabled =
    (view.deck.refineSlidesEnabled ?? true) ||
    (view.deck.refineTranscriptEnabled ?? true)

  // Slides whose original lecture audio the server said can be played back.
  const audioSlideIds = new Set(view.audioSlideIds ?? [])

  /** Stops original-audio playback and releases its blob URL. */
  const stopOriginalAudio = () => {
    originalAudioRef.current?.pause()
    originalAudioRef.current = null
    if (originalUrlRef.current) {
      URL.revokeObjectURL(originalUrlRef.current)
      originalUrlRef.current = null
    }
    setPlayingOriginalId(null)
  }

  /** Plays (or, if already playing this slide, stops) the slide's original
   * lecture audio. Stops TTS first so the two never overlap. */
  const playOriginalAudio = async (slideId: string) => {
    if (playingOriginalId === slideId) {
      stopOriginalAudio()
      return
    }
    stopOriginalAudio()
    tts.stop()
    setImageError(null)
    setPlayingOriginalId(slideId)
    try {
      const url = await fetchSlideOriginalAudioUrl(slideId)
      const audio = new Audio(url)
      originalAudioRef.current = audio
      originalUrlRef.current = url
      audio.onended = stopOriginalAudio
      audio.onerror = stopOriginalAudio
      await audio.play()
    } catch {
      stopOriginalAudio()
      setImageError(
        'Could not play the original audio — it may no longer be available',
      )
    }
  }

  return (
    <div
      className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col p-6"
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

      {/* View toggle, settings, and share live in the primary nav (header),
          not the floating pill; settings sits after the view buttons, and
          share sits rightmost, to the right of the settings icon. */}
      <ShellActions>
        <ViewModeToggle mode={mode} onChange={setMode} />
        {canEdit && (
          <Tooltip label="Lecture settings">
            <button
              aria-label="Lecture settings"
              onClick={() => openSettings()}
              className="rounded-md p-2 text-slate-500 hover:text-slate-900"
            >
              <Settings className="h-5 w-5" aria-hidden />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Share" align="end">
          <button
            aria-label="Share deck"
            onClick={() => openSettings('sharing')}
            className="rounded-md p-2 text-slate-500 hover:text-slate-900"
          >
            <Share className="h-5 w-5" aria-hidden />
          </button>
        </Tooltip>
      </ShellActions>

      <DeckPageHeader
        deckId={view.deck.id}
        actions={
          <>
            {ttsEnabled && (
              <Tooltip
                label={
                  view.slides.length === 0
                    ? 'Add a slide to play the deck'
                    : deckPlaying
                      ? 'Pause playback'
                      : 'Play deck aloud'
                }
              >
                <button
                  aria-label={deckPlaying ? 'Pause playback' : 'Play deck'}
                  aria-pressed={deckPlaying}
                  disabled={view.slides.length === 0}
                  onClick={() => tts.toggle(activePlayIndex())}
                  className={`rounded-md p-2 ${
                    deckPlaying
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-slate-500 hover:text-slate-900'
                  } disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:text-slate-300`}
                >
                  {deckPlaying ? (
                    <Pause className="h-5 w-5" aria-hidden />
                  ) : (
                    <Play className="h-5 w-5" aria-hidden />
                  )}
                </button>
              </Tooltip>
            )}
            {canEdit && (
              <>
                <Tooltip label="Add a slide">
                  <button
                    aria-label="Add slide"
                    onClick={() => void addSlide()}
                    className="rounded-md p-2 text-slate-500 hover:text-slate-900"
                  >
                    <Plus className="h-5 w-5" aria-hidden />
                  </button>
                </Tooltip>
                {SHOW_SEED_UPLOAD_IN_TOOLBAR && (
                  <Tooltip label="Seed material">
                    <button
                      aria-label="Add seed material"
                      onClick={openManualSeed}
                      className="rounded-md p-2 text-slate-500 hover:text-slate-900"
                    >
                      <UploadCloud className="h-5 w-5" aria-hidden />
                    </button>
                  </Tooltip>
                )}
                <Tooltip
                  label={
                    listening
                      ? 'Recording — click to stop'
                      : 'Speak to add slides'
                  }
                >
                  <button
                    aria-label="Live session"
                    aria-pressed={speaking}
                    onClick={() => {
                      // One toggle: the bar and the microphone together
                      if (speaking) stopListening()
                      else {
                        tts.stop() // never record while speaking (and vice-versa)
                        startListening()
                      }
                      setSpeaking(s => !s)
                    }}
                    // Recording fills solid red and pulses: the audience is
                    // live, so the state has to be unmissable at a glance
                    className={`rounded-md p-2 ${
                      listening
                        ? 'animate-pulse bg-red-600 text-white ring-2 ring-red-300'
                        : speaking
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <Mic className="h-5 w-5" aria-hidden />
                  </button>
                </Tooltip>
              </>
            )}
          </>
        }
      />

      {canEdit && view.slides.length > 0 && (
        <WhiteboardToolbar deckId={view.deck.id} whiteboard={whiteboard} />
      )}

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
                onReplaceImage={replaceSlideImage(slide!.id)}
                onPickImageCandidate={pickSlideImageCandidate(slide!.id)}
                onRemoveImage={removeSlideImage(slide!)}
                imagePending={pendingImages.has(slide!.id)}
              />
              <SlideMenu
                number={nav.current + 1}
                onSpeak={ttsEnabled ? () => speakSlide(slide!) : undefined}
                onChangeLayout={
                  canEdit ? () => setLayoutPickerFor(slide!.id) : undefined
                }
                onRefine={
                  canEdit && slideRefineEnabled
                    ? () => void refineSlide(slide!.id)
                    : undefined
                }
                onPlayOriginalAudio={
                  canEdit && audioSlideIds.has(slide!.id)
                    ? () => void playOriginalAudio(slide!.id)
                    : undefined
                }
                onDelete={
                  canEdit ? () => void deleteSlide(slide!.id) : undefined
                }
                elevated={whiteboard.tool != null}
                onOpen={() => whiteboard.setTool(null)}
              />
              <DrawingLayer {...drawingLayerProps} />
            </SlideNavZones>
          </div>
          <p className="mx-auto mt-4 text-sm text-slate-500">
            {nav.current + 1} / {view.slides.length}
          </p>
        </>
      ) : (
        <div className="relative w-full">
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
                    onReplaceImage={replaceSlideImage(s.id)}
                    onPickImageCandidate={pickSlideImageCandidate(s.id)}
                    onRemoveImage={removeSlideImage(s)}
                    imagePending={pendingImages.has(s.id)}
                  />
                  <SlideMenu
                    number={i + 1}
                    onSpeak={ttsEnabled ? () => speakSlide(s) : undefined}
                    onChangeLayout={() => setLayoutPickerFor(s.id)}
                    onRefine={
                      slideRefineEnabled
                        ? () => void refineSlide(s.id)
                        : undefined
                    }
                    onPlayOriginalAudio={
                      audioSlideIds.has(s.id)
                        ? () => void playOriginalAudio(s.id)
                        : undefined
                    }
                    onDelete={() => void deleteSlide(s.id)}
                    elevated={whiteboard.tool != null}
                    onOpen={() => whiteboard.setTool(null)}
                  />
                </DraggableListRow>
              ) : (
                <li key={s.id} ref={nav.registerItem(i)} className="relative">
                  <SlideView slide={s} template={view.template} />
                  {ttsEnabled && (
                    <SlideMenu number={i + 1} onSpeak={() => speakSlide(s)} />
                  )}
                </li>
              ),
            )}
          </ul>
          {/* One overlay spans the list; a stroke attaches to the slide whose
              center is nearest its centroid (WB / list view). */}
          <DrawingLayer {...drawingLayerProps} />
        </div>
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
            openSettings('template')
          }}
        />
      )}

      {canEdit && seedDialog && (
        <SeedDialog
          deck={view.deck}
          mode={seedDialog}
          onClose={closeSeed}
          onDeckChange={deck => setView(v => (v ? { ...v, deck } : v))}
        />
      )}

      {refiningSlideId && (
        <div className="fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
          <div
            role="status"
            className="flex items-center gap-3 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            Refining this slide…
          </div>
        </div>
      )}

      {playingOriginalId && (
        <div className="fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
          <div
            role="status"
            className="flex items-center gap-3 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            Playing original audio…
            <button
              onClick={stopOriginalAudio}
              className="text-white/80 hover:text-white"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {imageError && (
        <div className="fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
          <div
            role="alert"
            className="flex items-center gap-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            {imageError}
            <button
              aria-label="Dismiss"
              onClick={() => setImageError(null)}
              className="text-white/80 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {canEdit && settingsOpen && (
        <DeckSettingsModal
          deck={view.deck}
          projectGenerationFreedom={view.projectGenerationFreedom}
          projectTtsVoice={view.projectTtsVoice}
          initialTab={settingsTab ?? 'general'}
          isOwner={isOwner}
          onClose={closeSettings}
          onDeckChange={deck => setView(v => (v ? { ...v, deck } : v))}
          onDeleted={() => void navigate('/app')}
          onTemplateChange={(deck, template) =>
            setView(v => (v ? { ...v, deck, template } : v))
          }
          onReformatted={() => {
            // Reload the deck so the reformatted slides show behind the modal.
            apiFetch<DeckViewResponse>(`/api/decks/${slug}`)
              .then(setView)
              .catch(() => {
                // Quiet failure: the current view stays until the next load
              })
          }}
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
