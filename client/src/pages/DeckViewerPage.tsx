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
  SlotSpec,
} from '@slide-machine/shared'
import { apiFetch, ApiError } from '../api/http'
import { dispatchAction } from '../api/actions'
import {
  applySlideImageFromSource,
  pollSlideImage,
  uploadSlideImage,
} from '../api/slides'
import { useAuth } from '../auth/AuthContext'
import { useTimeAgo } from '../hooks/useTimeAgo'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import { useBracketKeys } from '../hooks/useBracketKeys'
import { useSpaceKey } from '../hooks/useSpaceKey'
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
import { getTtsEnabled } from '../runtime-config'
import LayoutPickerModal from '../components/LayoutPickerModal'
import DraggableListRow from '../components/DraggableListRow'
import EditableText from '../components/EditableText'
import DeckPageHeader from '../components/DeckPageHeader'
import Tooltip from '../components/Tooltip'
import SeedDialog from '../components/SeedDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import DeckSettingsModal, {
  type SettingsTabId,
} from '../components/DeckSettingsModal'
import { ShellTitle } from '../components/layout/ShellTitle'
import { ShellActions } from '../components/layout/ShellActions'
import ViewModeToggle, { type ViewMode } from '../components/ViewModeToggle'
import { lectureTitle, UNTITLED } from '../lib/lecture'

// Image/text detection derived from a layout's own slots, so the rules
// below work for any template rather than hardcoding layout names.

/** True when the layout has an image slot. */
const layoutHasImage = (layout: { slots: SlotSpec[] }): boolean =>
  layout.slots.some(s => s.kind === 'image')

// Slot roles that only label or annotate a slide, never carry its substance.
// An image slide paired only with one of these is still "image-only": removing
// the image leaves nothing worth keeping.
const ANCILLARY_TEXT_SLOTS = new Set(['title', 'caption', 'subtitle'])

/** True when the layout carries substantial editable text (a body paragraph
 * or bullets). A title or caption alone does not count, so an image-only
 * layout (image + caption, or image + title) reads as false. */
const layoutHasTextBody = (layout: { slots: SlotSpec[] }): boolean =>
  layout.slots.some(
    s =>
      s.kind === 'bullets' ||
      (s.kind === 'text' && !ANCILLARY_TEXT_SLOTS.has(s.name)),
  )

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
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(
    () =>
      (location.state as { settingsTab?: SettingsTabId } | null)?.settingsTab ??
      null,
  )
  const [settingsOpen, setSettingsOpen] = useState(() => settingsTab !== null)
  // Which slide the layout picker is open for (EDIT-3)
  const [layoutPickerFor, setLayoutPickerFor] = useState<string | null>(null)
  // Slide awaiting confirmation to delete after its only image is removed
  const [confirmImageDeleteId, setConfirmImageDeleteId] = useState<
    string | null
  >(null)
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
      })
      applyEvent(event)
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
   * Removes a slide's image. When the image is the whole slide (an image
   * layout with no body/bullets text) removing it would leave nothing, so
   * the slide is deleted after a confirm; otherwise the picture is cleared
   * and the slide drops to a text-only layout from THIS template, so
   * nothing looks broken. Both the image-only test and the target layout
   * come from the template's slots — no layout names are hardcoded, so
   * additional templates work without changes.
   */
  const removeSlideImage = (target: Slide) => () => {
    const layouts = view.template.layouts
    const current = layouts.find(l => l.type === target.layoutType)
    // Image-only: the image is the whole slide (no body/bullets text to
    // keep). Removing it would leave a blank slide, so confirm + delete.
    if (current && layoutHasImage(current) && !layoutHasTextBody(current)) {
      setConfirmImageDeleteId(target.id)
      return
    }
    // Image+text: clear the image and drop to a text-only layout from THIS
    // template. Prefer the no-image layout that best preserves the current
    // slide's non-image slots — i.e. the one whose slots overlap the current
    // text slots most, breaking ties toward the closest-sized layout. This
    // keeps a two-column slide on its content/body layout instead of falling
    // back to a title-style layout, all without hardcoding any layout names.
    const keepNames = new Set(
      (current?.slots ?? []).filter(s => s.kind !== 'image').map(s => s.name),
    )
    const textLayout =
      layouts
        .filter(l => !layoutHasImage(l) && layoutHasTextBody(l))
        .map(l => {
          const names = l.slots.map(s => s.name)
          const overlap = names.filter(n => keepNames.has(n)).length
          return { layout: l, overlap, extra: names.length - overlap }
        })
        .sort((a, b) => b.overlap - a.overlap || a.extra - b.extra)[0]
        ?.layout ?? layouts.find(l => !layoutHasImage(l))
    const cleared = dispatchAction<Slide>('slide.editContent', {
      slideId: target.id,
      imageRef: '',
    })
    const done = textLayout
      ? cleared.then(() =>
          dispatchAction<Slide>('slide.setLayout', {
            slideId: target.id,
            layoutType: textLayout.type,
          }),
        )
      : cleared
    done
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
              slides: v.slides.map(s => (s.id === res.slide.id ? res.slide : s)),
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
                onDelete={
                  canEdit ? () => void deleteSlide(slide!.id) : undefined
                }
              />
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
                    slideRefineEnabled ? () => void refineSlide(s.id) : undefined
                  }
                  onDelete={() => void deleteSlide(s.id)}
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

      {canEdit && confirmImageDeleteId && (
        <ConfirmDialog
          title="Delete this slide?"
          message="This slide is just an image. Removing it deletes the whole slide."
          confirmLabel="Delete slide"
          onConfirm={() => {
            void deleteSlide(confirmImageDeleteId)
            setConfirmImageDeleteId(null)
          }}
          onCancel={() => setConfirmImageDeleteId(null)}
        />
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
