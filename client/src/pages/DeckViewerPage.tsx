/**
 * Deck viewer reached by permalink (SHARE-1) — and, for the deck's
 * owner, the single surface for everything: in-place text editing,
 * adding/deleting/reordering slides, and the live session. The
 * microphone icon toggles the (typed, until STT lands) "Speak" bar,
 * whose phrases flow through session.phrase exactly as the streamed
 * pipeline will (GEN-1/CAP-1). Playback and the carousel/list switch
 * come from the shared slide-navigation codebase.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
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
  Locale,
  Slide,
  SlideEvent,
  SlideRefineOptions,
  SlideRefitLayoutResult,
  SlotValue,
  Stroke,
  StrokeAnchor,
  WordTiming,
} from '@slide-machine/shared'
import {
  SLIDE_PARAM,
  WHITEBOARD_LAYOUT_TYPE,
  hasVisibleDrawings,
  deckSourceLocale,
  overlaySlideTranslation,
} from '@slide-machine/shared'
import { strokeVisible, erasureReplays } from '../lib/drawing'
import { runLayoutFlip } from '../lib/layoutFlip'
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
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useTimeAgo } from '../hooks/useTimeAgo'
import { useSlideNavigation } from '../hooks/useSlideNavigation'
import { useSlideTranslation } from '../hooks/useSlideTranslation'
import { useBracketKeys } from '../hooks/useBracketKeys'
import { useSpaceKey } from '../hooks/useSpaceKey'
import { useUndoRedoKeys } from '../hooks/useUndoRedoKeys'
import { createSpeechCapture, type PhraseMeta } from '../stt/capture'
import { createInterimFlusher } from '../stt/interim-flush'
import {
  COMMAND_LABELS,
  matchVoiceCommand,
  type VoiceCommand,
} from '../stt/commands'
import SlideView, { type SlideContentPatch } from '../components/SlideView'
import SlideNavZones from '../components/SlideNavZones'
import SlideMenu from '../components/SlideMenu'
import { useTtsPlayback, type TtsPlayback } from '../tts/playback'
import {
  getInterimFlushEnabled,
  getInterimFlushWords,
  getRefineSlidesDefaultLevel,
  getSimulatedSpeechEnabled,
  getSttEngine,
  getTranslationEnabled,
  getTtsEnabled,
  getWhiteboardSuppressDebounceMs,
} from '../runtime-config'
import LayoutPickerModal from '../components/LayoutPickerModal'
import TranscriptEditorModal from '../components/TranscriptEditorModal'
import ConfirmDialog from '../components/ConfirmDialog'
import DraggableListRow from '../components/DraggableListRow'
import EditableText from '../components/EditableText'
import DeckPageHeader from '../components/DeckPageHeader'
import WhiteboardToolbar from '../components/whiteboard/WhiteboardToolbar'
import DrawingLayer from '../components/whiteboard/DrawingLayer'
import { useWhiteboard } from '../components/whiteboard/useWhiteboard'
import { themeColors } from '../components/slide/theme'
import Tooltip from '../components/Tooltip'
import NotificationPill from '../components/NotificationPill'
import SlideRefineModal from '../components/SlideRefineModal'
import SeedDialog from '../components/SeedDialog'
import DeckSettingsModal, {
  type SettingsTabId,
} from '../components/DeckSettingsModal'
import { ShellTitle } from '../components/layout/ShellTitle'
import { ShellActions } from '../components/layout/ShellActions'
import ViewModeToggle, { type ViewMode } from '../components/ViewModeToggle'
import VoteControl from '../components/VoteControl'
import SlideLanguageSwitcher from '../components/SlideLanguageSwitcher'
import SignInDialog, { type AuthGateFeature } from '../components/SignInDialog'
import { lectureTitle, untitledLecture } from '../lib/lecture'
import { untitledProject } from '../lib/project'

// The toolbar's "Seed material" upload button is hidden for now but its
// wiring (openManualSeed, the SeedDialog) is kept so it can return by
// flipping this to true — seeding still happens from the pre-lecture
// dialog and Lecture settings in the meantime.
const SHOW_SEED_UPLOAD_IN_TOOLBAR = false

/**
 * A list-view row whose contents are skipped until it is scrolled to. A
 * lecture of a hundred slides is a list some fifty thousand pixels tall, and
 * every slide is a query container measured against its own width; laying all
 * of them out at once is work no reader has asked for.
 *
 * `auto` in the intrinsic size means the real height is remembered once a
 * slide has been seen, so the figure here only has to be close before that: a
 * slide is 16:9 in a column capped at 5xl, which is 549px.
 *
 * Both list rows carry it. The reader's row always did; the owner's
 * (`DraggableListRow`) did not, which had the person who writes the long
 * lectures rendering all of one eagerly while a passing reader got the cheap
 * path.
 */
const DEFER_OFFSCREEN =
  '[contain-intrinsic-size:auto_549px] [content-visibility:auto]'

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

/** Slide count, modification age, and who wrote it, small beside the title
 * in the nav. The count is an ICU plural, so languages with more than two
 * forms get them right.
 *
 * Two boxes rather than one, and siblings of the heading rather than a pair
 * nested inside a wrapper: a nested pair would take its share of a narrow
 * header as a block, and spend it on the author once the stats ran out,
 * while the titles beside it still had room. As siblings they take their
 * turn in the header's own order — stats, then titles, then the author (see
 * the ShellTitle block below). The stats also give way from the LEFT, so
 * what goes is the count and the age, never the tail beside the name. */
function DeckTitleMeta({
  deck,
  count,
  owner,
}: {
  deck: Deck
  count: number
  /** The lecture's owner; their name links to their public profile (SOC-4). */
  owner?: { id: string; displayName: string }
}) {
  const { t } = useTranslation()
  const age = useTimeAgo(deck.updatedAt)
  return (
    <>
      {/* Right-aligned in a box that may be narrower than its text, so what
          does not fit falls off the left edge and is clipped there. */}
      <span className="flex min-w-0 shrink-1000 justify-end overflow-hidden text-xs font-normal text-slate-500">
        <span className="shrink-0 whitespace-nowrap">
          {t('deck.meta', { count, age })}
          {owner?.displayName && <span aria-hidden> ·</span>}
        </span>
      </span>
      {owner?.displayName && (
        // Never shrunk: everything else gives way around it, and the shell
        // clips the row if even this will not fit. Padded clear of the view
        // controls beside it.
        <span className="shrink-0 pe-3 text-xs font-normal whitespace-nowrap text-slate-500">
          {`${t('deck.byAuthor')} `}
          <Link
            to={`/u/${owner.id}`}
            className="hover:text-indigo-600 hover:underline"
          >
            {owner.displayName}
          </Link>
        </span>
      )}
    </>
  )
}

export default function DeckViewerPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, status } = useAuth()
  const isAdmin = useIsAdmin()
  // Which feature a signed-out visitor reached for, if any — playback,
  // narration, or translated viewing all need an account (AUTH-8). Raising
  // the dialog is just setting this; `user` flipping true on a successful
  // sign-in is what makes the gated controls live again, so nothing here
  // has to remember what to do next.
  const [authGate, setAuthGate] = useState<AuthGateFeature | null>(null)
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
  // Reading the slides in another language (SHARE-2). The translation is
  // fetched alongside the deck and laid over it at render time — `view.slides`
  // stays the authored text that every edit, narration and save path reads.
  const translationAvailable = getTranslationEnabled()
  // Translated viewing needs an account (AUTH-8), and the hook reaches it
  // two ways: an explicit choice in the switcher, and a language remembered
  // from a previous visit that it restores and fetches with nobody clicking.
  // The switcher is gated by `locked` below; the remembered language is
  // gated here, because the translation endpoint is deliberately
  // `optionalAuth` (SHARE-2) and would otherwise re-open the permalink fully
  // translated for a lapsed session with no gate ever raised.
  //
  // `status` matters as much as `user`: a signed-in reader's session is
  // restored asynchronously, so treating the `restoring` window as signed
  // out would drop their remembered language on every load. `null` says
  // "not yet known", and the hook waits.
  const translation = useSlideTranslation(
    slug,
    translationAvailable && Boolean(user),
    status === 'restoring' ? null : Boolean(user),
  )
  const sourceLocale = deckSourceLocale(
    view?.deck.language,
    view?.projectLanguage,
  )
  // A deck being read in its own language is not translated at all.
  const showingTranslation =
    translation.locale !== null && translation.locale !== sourceLocale
  /** The slide as it should be displayed — translated text over the original
   * when a translation is on, and the original itself otherwise. */
  const displaySlide = useCallback(
    (slide: Slide): Slide =>
      showingTranslation
        ? overlaySlideTranslation(slide, translation.perSlide[slide.id])
        : slide,
    [showingTranslation, translation.perSlide],
  )
  const [error, setError] = useState<string | null>(null)
  /**
   * Whether signing in could change the answer — true only for the 404 the
   * API gives a private deck, which is the same 404 it gives a deck that does
   * not exist. Someone arriving from outside the app (an assistant's link,
   * SPEC §18) hits this before they hit a login screen, and "does not exist or
   * is private" is a dead end unless it offers the one thing that might help.
   */
  const [signInMayHelp, setSignInMayHelp] = useState(false)
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
      'export',
      'sharing',
    ]
    return fromUrl && known.includes(fromUrl as SettingsTabId)
      ? (fromUrl as SettingsTabId)
      : null
  })
  const [settingsOpen, setSettingsOpen] = useState(() => settingsTab !== null)
  // Set once an admin has acknowledged editing settings that are not
  // theirs; the modal stays shut until then (ADMIN-5), including on the
  // deep links above, which open it without a click.
  const [adminEditConfirmed, setAdminEditConfirmed] = useState(false)

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
  // Which slide the spoken-transcript editor is open for (EDIT-6)
  const [transcriptEditorFor, setTranscriptEditorFor] = useState<string | null>(
    null,
  )
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
  /**
   * A split a refine just applied (GEN-4), while its notice is on screen.
   *
   * Nothing is being asked here — the instructor ticked "break this slide up"
   * before the run, so the slides already exist. This only tells them it
   * happened, and why, since a deck that quietly grew by two would be a
   * surprise worth explaining.
   */
  const [splitNotice, setSplitNotice] = useState<{
    /** 1-based position of the slide that was split, as it was shown. */
    number: number
    /** How many slides it became. */
    count: number
    /** The model's short phrase for what the parts are; may be empty. */
    reason: string
  } | null>(null)
  const splitNoticeTimerRef = useRef<number | null>(null)
  /** How long the split notice stays up. Long, like the refit undo: it is
   * asking the user to read a sentence before it goes. */
  const SPLIT_NOTICE_MS = 8000
  // An edit the server did not take. Cleared by the next one that lands, so
  // the notice never outlives the problem it describes.
  const [editFailed, setEditFailed] = useState(false)
  /** The last layout refit (GEN-9), while its undo is still offered: the
   * slide as it stood before, and the emptying patch that puts it back. */
  const [refitUndo, setRefitUndo] = useState<{
    slide: Slide
    cleared: Record<string, SlotValue>
  } | null>(null)
  const refitUndoTimerRef = useRef<number | null>(null)
  /** How long the refit's undo stays on offer. Longer than the other pills:
   * it is asking the user to read what was written before deciding. */
  const REFIT_UNDO_PILL_MS = 8000
  // The slide whose "Refine this slide with AI" dialog is open (GEN-4).
  const [refineSlideFor, setRefineSlideFor] = useState<string | null>(null)
  // Content-generation pause pill (WB-3): 'paused' while the user is actively
  // drawing during recording (with a Resume button to override), 'resumed' for
  // a brief confirmation after the debounce elapses or the user resumes, and
  // null when hidden.
  const [generationPause, setGenerationPause] = useState<
    'paused' | 'resumed' | null
  >(null)
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
  // Wall-clock of the last drawing/erasing gesture (WB-3). While the user is
  // actively marking up a slide — including a debounce grace after the last
  // gesture so switching tools or repositioning still counts — content
  // generation is paused: speech is still transcribed, but no slide is created
  // or changed (see submitPhrase and the generation-pause pill).
  const lastDrawActivityRef = useRef<number | null>(null)
  /** True while the user is actively marking up a slide (within the debounce
   * grace after the last gesture). */
  const isActivelyDrawing = (): boolean => {
    const last = lastDrawActivityRef.current
    return last != null && Date.now() - last < getWhiteboardSuppressDebounceMs()
  }
  // Generation-pause pill timers: one auto-resumes when drawing goes idle past
  // the debounce, one hides the "resumed" confirmation after a moment. A manual
  // Resume sets an override so generation keeps running for the rest of the
  // current drawing bout (a fresh bout, after going idle, pauses again).
  const genPauseResumeTimerRef = useRef<number | null>(null)
  const genPauseHideTimerRef = useRef<number | null>(null)
  // Putting away an active drawing tool ends the markup bout: a short grace
  // timer then resumes generation, the same as clicking Resume.
  const toolDeselectResumeTimerRef = useRef<number | null>(null)
  const genManuallyResumedRef = useRef(false)
  // Which source is holding the pause pill open: the drawing-gesture debounce,
  // or being on a whiteboard slide (manual-resume only). Lets the two sources
  // hand the single pill off cleanly.
  const pauseSourceRef = useRef<'drawing' | 'whiteboard' | null>(null)
  // Whether the user clicked Resume on the current whiteboard slide; reset when
  // the current slide changes so each whiteboard slide pauses afresh.
  const whiteboardResumedRef = useRef(false)
  /** How long the "Content generation resumed" confirmation stays up (ms). */
  const GENERATION_RESUMED_PILL_MS = 3000
  /** Grace after deselecting a drawing tool before generation resumes (ms) —
   * long enough to ignore a quick tool switch, short enough to feel immediate. */
  const TOOL_DESELECT_RESUME_MS = 600
  /** True while the current slide is a blank whiteboard canvas (read through
   * refs so mic-queue closures see the live slide). */
  const onWhiteboardSlideNow = (): boolean =>
    viewRef.current?.slides[currentRef.current]?.layoutType ===
    WHITEBOARD_LAYOUT_TYPE
  /** Whether this phrase should skip generation. On a whiteboard slide,
   * generation is paused until the user clicks Resume (no debounce); elsewhere,
   * while actively drawing and not manually resumed for the current bout. */
  const isGenerationPaused = (): boolean =>
    onWhiteboardSlideNow()
      ? !whiteboardResumedRef.current
      : isActivelyDrawing() && !genManuallyResumedRef.current
  const clearPauseTimers = () => {
    if (genPauseResumeTimerRef.current) {
      window.clearTimeout(genPauseResumeTimerRef.current)
      genPauseResumeTimerRef.current = null
    }
    if (genPauseHideTimerRef.current) {
      window.clearTimeout(genPauseHideTimerRef.current)
      genPauseHideTimerRef.current = null
    }
    if (toolDeselectResumeTimerRef.current) {
      window.clearTimeout(toolDeselectResumeTimerRef.current)
      toolDeselectResumeTimerRef.current = null
    }
  }
  /** Flips the pill to a brief "resumed" confirmation, then hides it. */
  const showResumedConfirmation = () => {
    setGenerationPause('resumed')
    if (genPauseHideTimerRef.current)
      window.clearTimeout(genPauseHideTimerRef.current)
    genPauseHideTimerRef.current = window.setTimeout(
      () => setGenerationPause(null),
      GENERATION_RESUMED_PILL_MS,
    )
  }
  /** Resumes generation — from the idle debounce ('timeout') or the Resume
   * button ('manual') — flips the pill to a brief confirmation, then hides it. */
  const resumeGeneration = (reason: 'timeout' | 'manual') => {
    if (genPauseResumeTimerRef.current) {
      window.clearTimeout(genPauseResumeTimerRef.current)
      genPauseResumeTimerRef.current = null
    }
    if (toolDeselectResumeTimerRef.current) {
      window.clearTimeout(toolDeselectResumeTimerRef.current)
      toolDeselectResumeTimerRef.current = null
    }
    if (reason === 'manual') {
      // Keep generating for the rest of this drawing bout / whiteboard slide.
      genManuallyResumedRef.current = true
      whiteboardResumedRef.current = true
    }
    pauseSourceRef.current = null
    showResumedConfirmation()
  }
  /** Shows/refreshes the paused pill and re-arms the idle auto-resume timer
   * (the drawing-gesture debounce; whiteboard slides use manual resume only). */
  const enterGenerationPause = () => {
    if (genPauseHideTimerRef.current) {
      window.clearTimeout(genPauseHideTimerRef.current)
      genPauseHideTimerRef.current = null
    }
    pauseSourceRef.current = 'drawing'
    setGenerationPause('paused')
    if (genPauseResumeTimerRef.current)
      window.clearTimeout(genPauseResumeTimerRef.current)
    genPauseResumeTimerRef.current = window.setTimeout(
      () => resumeGeneration('timeout'),
      getWhiteboardSuppressDebounceMs(),
    )
  }
  /** Clears the pause pill and its timers outright — no confirmation (used when
   * the mic stops, where generation is moot). */
  const clearGenerationPause = () => {
    clearPauseTimers()
    genManuallyResumedRef.current = false
    whiteboardResumedRef.current = false
    pauseSourceRef.current = null
    setGenerationPause(null)
  }
  const noteDrawActivity = () => {
    const wasActive = isActivelyDrawing()
    lastDrawActivityRef.current = Date.now()
    // Pausing only matters while recording; drawing on a static deck is free.
    if (!listening) return
    // Whiteboard slides run the manual-only pause (driven by the effect below),
    // so drawing gestures there must not arm the debounce auto-resume.
    if (onWhiteboardSlideNow()) return
    // A fresh drawing bout (the previous debounce had elapsed) drops any manual
    // Resume override, so the new markup session pauses generation again.
    if (!wasActive) genManuallyResumedRef.current = false
    if (!genManuallyResumedRef.current) enterGenerationPause()
  }
  // Never let a pause-pill timer fire after the page unmounts.
  useEffect(
    () => () => {
      if (genPauseResumeTimerRef.current)
        window.clearTimeout(genPauseResumeTimerRef.current)
      if (genPauseHideTimerRef.current)
        window.clearTimeout(genPauseHideTimerRef.current)
      if (toolDeselectResumeTimerRef.current)
        window.clearTimeout(toolDeselectResumeTimerRef.current)
    },
    [],
  )
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
  // Deck narration follows the user: moving slides (arrow keys or the chevron
  // zones) while the deck is playing skips the TTS to that slide. Held in a ref
  // because the playback controller is created below, from this nav.
  const ttsRef = useRef<TtsPlayback | null>(null)
  const nav = useSlideNavigation(view?.slides.length ?? 0, mode, index =>
    ttsRef.current?.skipTo(index),
  )
  const { setCurrent, scrollTo } = nav
  // Always-fresh mirror of the current slide index, so voice commands running
  // from stale mic-queue closures can tell whether the deck is at its end.
  const currentRef = useRef(nav.current)
  useEffect(() => {
    currentRef.current = nav.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.current])

  // Whiteboard slide = a dedicated drawing canvas: while recording on one,
  // content generation is paused until the user clicks Resume (no debounce).
  const activeSlide = view?.slides[nav.current]
  const onWhiteboardSlide = activeSlide?.layoutType === WHITEBOARD_LAYOUT_TYPE
  // Each whiteboard slide the user lands on pauses afresh.
  useEffect(() => {
    whiteboardResumedRef.current = false
  }, [activeSlide?.id])
  useEffect(() => {
    if (onWhiteboardSlide && listening && !whiteboardResumedRef.current) {
      // Manual-only pause: cancel any debounce/hide timers so it never
      // auto-resumes, and hold the paused pill open until the user resumes.
      clearPauseTimers()
      pauseSourceRef.current = 'whiteboard'
      setGenerationPause('paused')
    } else if (!onWhiteboardSlide && pauseSourceRef.current === 'whiteboard') {
      // Left the canvas — e.g. the user made a new regular slide (toolbar +,
      // or a "new slide" command), or navigated away: the whiteboard pause
      // ends and generation resumes. Confirm it, then hide.
      clearPauseTimers()
      pauseSourceRef.current = null
      showResumedConfirmation()
    }
  }, [onWhiteboardSlide, listening, activeSlide?.id])

  // Deselecting the active drawing tool ends the markup bout: if generation is
  // paused for drawing (the debounce mode, not a whiteboard slide's manual-only
  // pause), resume after a short grace via the Resume path. Re-arming a tool
  // before the grace elapses cancels it — the user is still drawing.
  const prevToolRef = useRef(whiteboard.tool)
  useEffect(() => {
    const deselected = prevToolRef.current != null && whiteboard.tool == null
    prevToolRef.current = whiteboard.tool
    if (whiteboard.tool != null) {
      if (toolDeselectResumeTimerRef.current) {
        window.clearTimeout(toolDeselectResumeTimerRef.current)
        toolDeselectResumeTimerRef.current = null
      }
      return
    }
    if (deselected && pauseSourceRef.current === 'drawing') {
      if (toolDeselectResumeTimerRef.current)
        window.clearTimeout(toolDeselectResumeTimerRef.current)
      toolDeselectResumeTimerRef.current = window.setTimeout(() => {
        toolDeselectResumeTimerRef.current = null
        resumeGeneration('manual')
      }, TOOL_DESELECT_RESUME_MS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboard.tool])

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
        const missing = err instanceof ApiError && err.status === 404
        setSignInMayHelp(missing)
        setError(
          missing
            ? 'This deck does not exist or is private'
            : 'Could not load this deck',
        )
      })
    return () => {
      cancelled = true
    }
  }, [slug, status])

  /**
   * A link from outside naming one slide — `?slide=<slide id>`, which an
   * assistant working over MCP hands back so the instructor can look at what
   * it changed (docs/MCP.md).
   *
   * Honoured once per address rather than on every render: the deck reloads
   * for reasons of its own, and re-running this would drag the reader back to
   * the linked slide each time they had moved off it.
   */
  const jumpedToRef = useRef<string | null>(null)
  useEffect(() => {
    if (!view) return
    const wanted = new URLSearchParams(location.search).get(SLIDE_PARAM)
    if (!wanted || jumpedToRef.current === wanted) return
    jumpedToRef.current = wanted
    const index = view.slides.findIndex(slide => slide.id === wanted)
    // A slide id this deck does not have — one since deleted, a mistyped
    // link — opens the deck at the beginning rather than failing the page.
    if (index < 0) return
    setCurrent(index)
    // List view scrolls to it; carousel view has already swapped slide. The
    // frame's wait is what the other jump sites do — the row has to exist
    // before it can be scrolled to, and landing on index 0 changes no state
    // for the navigation's own scroll effect to react to.
    requestAnimationFrame(() => scrollTo(index))
  }, [view, location.search, setCurrent, scrollTo])

  // Stop any in-flight image polling when the viewer unmounts
  useEffect(() => {
    const cancels = pollCancelsRef.current
    return () => {
      cancels.forEach(cancel => cancel())
      cancels.clear()
    }
  }, [])

  // Debug flag: the simulated-speech box is rendered only when a server turns
  // it on (SIMULATED_SPEECH_ENABLED), so typed phrases stay a dev affordance.
  const simulatedSpeechEnabled = getSimulatedSpeechEnabled()

  // Opening the live session focuses the phrase input (when it is shown)
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

  /** Replaces one slide in the view, by id. */
  const putSlide = (next: Slide) =>
    setView(v =>
      v
        ? { ...v, slides: v.slides.map(s => (s.id === next.id ? next : s)) }
        : v,
    )

  /**
   * Fills the boxes a layout switch left empty (GEN-9), once the switch
   * itself has landed and animated.
   *
   * Off the critical path on purpose: the server has already carried every
   * box that paired across, so the slide is correct and on screen before
   * this runs. It also costs nothing when there is nothing to do — the
   * action makes no AI call unless the new layout has holes AND the old one
   * left content behind, which no switch between the built-ins does.
   *
   * What it writes is undoable, because it is the one part of a layout
   * switch the user did not spell out.
   */
  const refitSlideLayout = async (slide: Slide, fromLayoutType: string) => {
    try {
      const res = await dispatchAction<SlideRefitLayoutResult>(
        'slide.refitLayout',
        { slideId: slide.id, fromLayoutType },
      )
      if (!res.filled.length) return
      putSlide(res.slide)
      // The pre-refit slide is what "undo" restores: the switch stays, only
      // the boxes the refit wrote into go back to empty. Emptying exactly
      // those is safe whatever the user does next — it never touches a box
      // the refit did not write.
      const cleared = Object.fromEntries(
        res.filled.map(name => [
          name,
          res.slide.slots?.[name]?.kind === 'bullets'
            ? ({ kind: 'bullets', items: [] } as SlotValue)
            : ({ kind: 'text', value: '' } as SlotValue),
        ]),
      )
      setRefitUndo({ slide, cleared })
      // The offer expires: a pill that never leaves reads as an error, and
      // by then the user has moved on and the written text is theirs.
      if (refitUndoTimerRef.current)
        window.clearTimeout(refitUndoTimerRef.current)
      refitUndoTimerRef.current = window.setTimeout(
        () => setRefitUndo(null),
        REFIT_UNDO_PILL_MS,
      )
      touchDeckLocally()
    } catch {
      // Quiet failure: the boxes stay empty and the user can type into them
    }
  }

  /** Puts back the slide as it stood before the refit wrote into it. */
  const undoRefit = () => {
    const undo = refitUndo
    setRefitUndo(null)
    if (refitUndoTimerRef.current)
      window.clearTimeout(refitUndoTimerRef.current)
    if (!undo) return
    putSlide(undo.slide)
    void dispatchAction<Slide>('slide.editContent', {
      slideId: undo.slide.id,
      slots: undo.cleared,
    }).catch(() => undefined)
  }

  /** Per-slide layout switch (EDIT-3): content stays, arrangement changes.
   * The swap animates as a layout morph (GEN-9): the slots glide to their
   * new places rather than jumping. */
  const setSlideLayout = (slideId: string, layoutType: string) => {
    const from = viewRef.current?.slides.find(s => s.id === slideId)?.layoutType
    dispatchAction<Slide>('slide.setLayout', { slideId, layoutType })
      .then(updated => {
        void runLayoutFlip(updated.id, () => putSlide(updated))
        // Switching onto an image layout sources an image server-side; the
        // returned slide carries the search intent, so poll for it to land.
        watchImage(updated)
        touchDeckLocally()
        if (from && from !== updated.layoutType)
          void refitSlideLayout(updated, from)
      })
      .catch(() => {
        // Quiet failure: the slide keeps its layout
      })
    setLayoutPickerFor(null)
  }

  /**
   * Steps the active slide through the template's layouts (EDIT-3) via
   * the "[" / "]" keys. The active slide is the displayed one in carousel
   * view; in list view it's whichever slide is actually on screen, so a
   * scroll away from a stale `current` still targets what's in front of the
   * reader. `visibleIndex()` only measures items the list has registered
   * against the window, so it reports nothing once every row has scrolled
   * past (the reader is down in the footer, say) — `nav.current` is the
   * last slide an explicit move landed on, and is what activePlayIndex and
   * activeWhiteboardSlideId already fall back to in the same spot. Wraps
   * around and is a no-op unless the viewer can edit.
   */
  const cycleLayout = (direction: 1 | -1) => {
    const v = viewRef.current
    if (!v?.canEdit) return
    const layouts = v.template.layouts
    if (layouts.length < 2) return
    const index =
      mode === 'carousel' ? nav.current : (nav.visibleIndex() ?? nav.current)
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
    // An AI re-fit that changes an already-displayed slide's layout morphs
    // via an animated layout flip (GEN-9); pure content updates stay
    // instant to keep the live view stable (GEN-5).
    const prior = isNew ? undefined : slides.find(s => s.id === next.id)
    const layoutChanged = Boolean(prior && prior.layoutType !== next.layoutType)
    const commit = () =>
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
    if (layoutChanged) {
      void runLayoutFlip(next.id, commit)
    } else {
      commit()
    }
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
        // While generation is paused (actively drawing, not manually resumed),
        // the server records this phrase to the transcript but skips slide
        // generation entirely — no content or layout change (WB-3). The "+"
        // button and the "new slide" voice command bypass this path.
        ...(isGenerationPaused() ? { pauseGeneration: true } : {}),
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
    // Generation is moot with the mic off — drop the pause pill without a
    // "resumed" flash.
    clearGenerationPause()
    // Ending a google-cloud recording makes the server flush its audio to
    // storage and attach it to the deck — asynchronously, on socket close. The
    // deck view computed audioSlideIds at load, so poll it for a short window
    // to reveal the per-slide "Play original audio" option without a reload.
    if (getSttEngine() === 'google-cloud') refreshAudioAvailability()
  }

  /** Polls the deck view until new retained audio appears (or the window
   * elapses), merging only the recording-derived flags (audioSlideIds for the
   * per-slide "Play original audio" option, and deck.hasRecordings for the
   * Refine tab's speaker-ID toggle) so local slide/deck edits are untouched. */
  const refreshAudioAvailability = () => {
    const had = new Set(viewRef.current?.audioSlideIds ?? [])
    let tries = 0
    const poll = () => {
      tries++
      apiFetch<DeckViewResponse>(`/api/decks/${slug}`)
        .then(fresh => {
          const ids = fresh.audioSlideIds ?? []
          setView(v =>
            v
              ? {
                  ...v,
                  audioSlideIds: ids,
                  deck: { ...v.deck, hasRecordings: fresh.deck.hasRecordings },
                }
              : v,
          )
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
  const addSlide = async (layoutType?: string): Promise<Slide | null> => {
    const current = viewRef.current
    if (!current) return null
    try {
      const nextIndex = current.slides.length
      const added = await dispatchAction<Slide>('slide.add', {
        deckId: current.deck.id,
        ...(layoutType ? { layoutType } : {}),
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
      return added
    } catch {
      // Quiet failure
      return null
    }
  }

  /** Appends a blank whiteboard slide and arms the pen, so the user can start
   * drawing at once (the whiteboard toolbar's new-slide button). */
  const addWhiteboardSlide = async () => {
    const added = await addSlide(WHITEBOARD_LAYOUT_TYPE)
    if (added) whiteboard.setTool('pen')
  }

  /** Executes a wake-worded voice command (CAP-4). Navigation goes
   * through functional setCurrent so stale closures stay correct. */
  const runVoiceCommand = (command: VoiceCommand) => {
    if (command === 'next' || command === 'previous') {
      const count = viewRef.current?.slides.length ?? 0
      // "Next" past the last slide creates a new one (like the "+" button and
      // the "new slide" command) rather than staying put, so the speaker can
      // keep moving forward without breaking stride.
      if (command === 'next' && currentRef.current >= count - 1) {
        void addSlide()
      } else {
        const delta = command === 'next' ? 1 : -1
        setCurrent(c => {
          const target = Math.max(0, Math.min(count - 1, c + delta))
          requestAnimationFrame(() => nav.scrollTo(target))
          return target
        })
      }
    } else if (command === 'pause') {
      stopListening()
    } else if (command === 'resume') {
      // Exactly the pill's Resume button (GEN-10): the same resumeGeneration
      // call, and the same pill as its only confirmation — hence the early
      // return, which skips the interim echo a click never produces. The
      // button exists only while paused, so an unpaused "resume" does nothing
      // rather than pre-authorizing the next drawing bout. Read the pause
      // through the ref: this runs from a mic closure captured when listening
      // began, where the generationPause state would be stale.
      if (pauseSourceRef.current) resumeGeneration('manual')
      return
    } else if (command === 'newSlide') {
      void addSlide()
    } else if (command === 'newWhiteboardSlide') {
      // Same as the whiteboard toolbar's new-slide button: blank canvas + pen.
      void addWhiteboardSlide()
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
   * command, which acts immediately and never reaches generation.
   *
   * With the interim flush on (GEN-12), long uninterrupted speech also
   * generates mid-utterance: once the interim transcript's stable prefix
   * outgrows the word threshold it is queued as a phrase, and the eventual
   * finalized utterance submits only the words not already flushed. Command
   * matching stays on finalized text only, so a half-heard interim can
   * never fire a command. */
  const beginCapture = () => {
    const flusher = getInterimFlushEnabled()
      ? createInterimFlusher(getInterimFlushWords())
      : null
    capture.start(
      {
        onPhrase: (text, meta) => {
          setInterim('')
          const remainder = flusher ? flusher.final(text) : null
          const phrase = remainder ? remainder.text : text
          const command = matchVoiceCommand(phrase)
          if (command) {
            runVoiceCommand(command)
            return
          }
          if (!phrase) return
          // Word timings span the whole utterance; keep the tail that
          // matches what is actually being submitted.
          const phraseMeta =
            remainder?.flushed && meta?.words
              ? {
                  ...meta,
                  words: meta.words.slice(-phrase.split(/\s+/).length),
                }
              : meta
          phraseQueueRef.current = phraseQueueRef.current.then(() =>
            submitPhrase(phrase, phraseMeta),
          )
        },
        onInterim: (text, meta) => {
          const flush = flusher?.interim(text)
          if (flush)
            phraseQueueRef.current = phraseQueueRef.current.then(() =>
              submitPhrase(flush, meta),
            )
          setInterim(text)
        },
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

  // The language narration should be spoken in (PLAY-3): the one the slides
  // are being displayed in. A translation that failed to load is showing the
  // authored text, so it is spoken in the authored language too.
  const spokenLocale =
    showingTranslation && !translation.failed ? translation.locale : null
  const spokenLocaleRef = useRef(spokenLocale)
  useEffect(() => {
    spokenLocaleRef.current = spokenLocale
  })

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
    // Narration follows the language on screen (PLAY-3). Read through a ref so
    // a switch mid-deck is picked up by the next slide.
    getLocale: () => spokenLocaleRef.current,
  })
  // Keep the mirror current so slide navigation always skips the live playback.
  useEffect(() => {
    ttsRef.current = tts
  })
  /** The slide the deck play button starts from: the active one per mode. */
  const activePlayIndex = (): number =>
    mode === 'carousel' ? nav.current : (nav.visibleIndex() ?? nav.current)
  /** Whether any narration is speaking — deck playback or a single slide via
   * the kebab's "Speak this slide" — so the toolbar button always reflects
   * (and can pause) what is heard. */
  const narrationPlaying = tts.status === 'playing'
  /** Speaks a slide's content (kebab option), stopping any current playback. */
  const speakSlide = (slide: Slide) => tts.speakSlide(slide)
  /** Deck playback (play/pause button and the space shortcut below): a
   * signed-out visitor raises the sign-in dialog instead (AUTH-8). */
  const requestPlayback = () => {
    if (!user) {
      setAuthGate('playback')
      return
    }
    tts.toggle(activePlayIndex())
  }
  /** The kebab's "Speak this slide": gated the same way as deck playback,
   * but named separately — narration is its own ask (AUTH-8). */
  const requestSpeakSlide = (slide: Slide) => {
    if (!user) {
      setAuthGate('narration')
      return
    }
    speakSlide(slide)
  }
  // Space toggles narration play/pause, matching the toolbar button —
  // active only when TTS is on and the deck has slides to play.
  useSpaceKey(requestPlayback, ttsEnabled && (view?.slides.length ?? 0) > 0)

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

  // A change to how the deck sounds should be heard immediately. The server
  // already picks up the new voice — or the new language (PLAY-3) — on the next
  // synthesis, but the audio playing right now was made with the old one, so
  // re-trigger the current item instead of waiting for the next slide.
  const narrationKey = `${view?.deck.ttsVoice ?? ''}|${spokenLocale ?? ''}`
  const lastNarrationRef = useRef(narrationKey)
  useEffect(() => {
    if (lastNarrationRef.current === narrationKey) return
    lastNarrationRef.current = narrationKey
    if (tts.status === 'idle') return // the next play already uses the new one
    const index = tts.activeIndex ?? activePlayIndex()
    if (tts.scope === 'deck') tts.playDeck(index)
    else {
      const slide = viewRef.current?.slides[index]
      if (slide) tts.speakSlide(slide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationKey])

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

  /**
   * Changes the language the slides are read in, ending any live session
   * first. The microphone leaves the toolbar with the rest of the editing
   * surface, so a session left running would keep recording — and keep
   * adding slides — with nothing on screen to stop it.
   */
  const setSlideLanguage = (next: Locale | null) => {
    const translating = next !== null && next !== sourceLocale
    if (translating && (speaking || listening)) {
      stopListening()
      setSpeaking(false)
    }
    translation.setLocale(next)
  }

  /**
   * A click on empty space — the page background, or the slide's own
   * background between its boxes — briefly reveals blank slots (styled in
   * index.css), which hide again on their own half a second later.
   *
   * The slide counts because that is where an editor is already looking: a
   * blank box shows nothing at rest, so the click that asks "what is on this
   * slide?" is the one aimed at the slide itself. Clicking a box is not that
   * question — it edits — so every slot is exempt, found by the
   * `data-flip-slot` wrapper each one renders inside; so are controls, links,
   * modal backdrops, and the drawing canvas, whose clicks are strokes.
   */
  const canEditView = Boolean(view?.canEdit)
  useEffect(() => {
    if (!canEditView) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (
        target?.closest(
          'a, button, input, textarea, select, label, [role], [aria-hidden], [data-flip-slot], [data-testid="drawing-layer"]',
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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
        <p role="alert">{error}</p>
        {signInMayHelp && status === 'anonymous' && (
          <Link
            className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
            to="/login"
            state={{ from: `${location.pathname}${location.search}` }}
          >
            {t('auth.signIn')}
          </Link>
        )}
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        {t('common.loading')}
      </div>
    )
  }

  const slide = view.slides[nav.current]
  const isOwner = user?.id === view.deck.ownerId
  const canEdit = view.canEdit
  // An allowlisted admin can open any lecture read-only (ADMIN-3), and
  // may edit its SETTINGS from the owner's own modal (ADMIN-5) — never
  // its slides. `canEdit` still gates all of the content editing below.
  const adminOverride = !canEdit && isAdmin === true
  // Which of the two a non-editor is — an admin about to be asked, or a
  // plain viewer — is unknown until the admin check answers.
  const rightsPending = !canEdit && isAdmin === null
  const askAdmin = settingsOpen && adminOverride && !adminEditConfirmed

  /** In-place edits (EDIT-1) persist through the action layer. */
  const editSlide = (slideId: string) => (patch: SlideContentPatch) => {
    dispatchAction<Slide>('slide.editContent', { slideId, ...patch })
      .then(updated => {
        setEditFailed(false)
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
        /*
         * A save that did not happen is said out loud.
         *
         * This used to be an empty catch, justified as "the on-screen text
         * simply reverts to the saved value" — which is true, and is exactly
         * what makes it unsafe. Reverting is also what a box does when the
         * save SUCCEEDED and something else overwrote it, so the two are
         * indistinguishable from the author's chair, and losing a paragraph
         * looks like a rendering quirk. Three reviewers spent four rounds on
         * that. The text reverting is the symptom, not the message.
         */
        setEditFailed(true)
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
      const offset = wordIdx >= 0 ? wordIdx : 0
      return {
        charAnchor: phraseStart + offset,
        source: 'word',
        sessionId: info.sessionId,
        sessionMs: drawMs,
        // Durable phrase fingerprint + intra-phrase position, so a transcript
        // refine can re-anchor this mark to the conceptually-closest new phrase
        // rather than a proportional point (WB-2).
        phraseText: info.phrase,
        phraseOffset: info.phrase.length ? offset / info.phrase.length : 0,
      }
    }
    return { charAnchor: len, source: 'appended' }
  }

  const onCommitStroke = (slideId: string, stroke: Stroke) => {
    recordDrawingHistory(slideId)
    updateDrawings(slideId, prev => [...prev, stroke])
  }

  /** Whole-stroke erase. When the erasure can replay in sync (the stroke and
   * the erase are both transcript-tied), keep the stroke and stamp it with an
   * erase anchor so playback replays its removal. Otherwise — an unsynced mark,
   * or an erase made mic-off — there's no timeline to replay it on, so just
   * remove the stroke outright (WB-2). */
  const onEraseStroke = (
    slideId: string,
    strokeId: string,
    anchor: StrokeAnchor,
  ) => {
    recordDrawingHistory(slideId)
    updateDrawings(slideId, prev =>
      prev.flatMap(s => {
        if (s.id !== strokeId || s.erasedAnchor) return [s]
        return erasureReplays(s, anchor)
          ? [{ ...s, erasedAnchor: anchor, erasedAt: new Date().toISOString() }]
          : []
      }),
    )
  }

  /** Playback visibility for a stroke (WB-2): reveal by its draw anchor and
   * hide again at its erase anchor, in step with the audio position — but
   * unsynced (mic-off) marks always show. Delegates to the pure `strokeVisible`. */
  const revealStroke = (slideId: string, stroke: Stroke): boolean => {
    const slides = viewRef.current?.slides ?? []
    const idx = slides.findIndex(s => s.id === slideId)
    const len = slides[idx]?.sourceTranscript?.length ?? 0
    return strokeVisible(stroke, idx, len, tts.getProgress(), {
      // Timed marks are anchored inside the original transcript, and those
      // anchors do not survive translation, so a translated playback skips
      // them and shows only the untimed ones (PLAY-3).
      translated: Boolean(spokenLocale),
    })
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
  const replaceSlideImage =
    (slideId: string) => (file: File, slot?: string) => {
      setImageError(null)
      uploadSlideImage(slideId, file, slot)
        .then(applySlide)
        .catch(() => setImageError('Could not upload the image — try again'))
    }

  /** Applies a chosen web-search image to a slide (EDIT-1). */
  const pickSlideImageCandidate =
    (slideId: string) => (candidate: ImageSearchCandidate, slot?: string) => {
      setImageError(null)
      applySlideImageFromSource(
        slideId,
        candidate.url,
        candidate.attribution,
        slot,
      )
        .then(applySlide)
        .catch(() => setImageError('Could not set that image — try again'))
    }

  /**
   * Removes a slide's image, keeping the slide's layout unchanged so the
   * image slot simply becomes empty (an editor can drop a new image in). The
   * layout is deliberately NOT switched and the slide is never deleted — even
   * an image-only layout just shows its empty image slot.
   */
  const removeSlideImage =
    (target: Slide) =>
    (slot = 'image') => {
      dispatchAction<Slide>('slide.editContent', {
        slideId: target.id,
        // Every picture lives in a slot of its own, so emptying one addresses
        // it by name — a layout may hold several (TMPL-9).
        slots: { [slot]: { kind: 'image', ref: '' } },
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

  /** Raises the "this slide became several" notice and takes it down again
   * after a while, replacing any notice still showing. */
  const showSplitNotice = (notice: {
    number: number
    count: number
    reason: string
  }) => {
    if (splitNoticeTimerRef.current)
      window.clearTimeout(splitNoticeTimerRef.current)
    setSplitNotice(notice)
    splitNoticeTimerRef.current = window.setTimeout(
      () => setSplitNotice(null),
      SPLIT_NOTICE_MS,
    )
  }

  /** Refines one slide with the lecture's Refine settings, then patches it in
   * place. Runs synchronously (one slide is quick); a toast names the slide. */
  const refineSlide = async (slideId: string, options?: SlideRefineOptions) => {
    setRefiningSlideId(slideId)
    setImageError(null)
    try {
      const res = await dispatchAction<DeckRefineSlideResult>(
        'deck.refineSlide',
        { deckId: view.deck.id, slideId, options },
      )
      // A refine that re-fits the slide onto a different layout morphs
      // like a manual layout switch (GEN-9); content-only refines stay
      // instant. Read through the ref: the closure view is stale after
      // the await.
      const prior = viewRef.current?.slides.find(s => s.id === res.slide.id)
      const layoutChanged = Boolean(
        prior && prior.layoutType !== res.slide.layoutType,
      )
      // A refine the instructor allowed to split comes back having already
      // made the slides. They are spliced in directly after the original,
      // which kept its id and now holds the first part, and the order comes
      // from the server rather than being rebuilt here: it is what decides
      // which slides the deck shows, and adding to `slides` alone would add
      // slides the viewer never renders.
      const split = res.split
      const commit = () =>
        setView(v => {
          if (!v) return v
          const slides = v.slides.map(s =>
            s.id === res.slide.id ? res.slide : s,
          )
          if (!split) return { ...v, slides }
          const at = slides.findIndex(s => s.id === res.slide.id)
          return {
            ...v,
            deck: { ...v.deck, slideOrder: split.slideOrder },
            slides:
              at === -1
                ? slides
                : [
                    ...slides.slice(0, at + 1),
                    ...split.added,
                    ...slides.slice(at + 1),
                  ],
          }
        })
      if (layoutChanged) {
        void runLayoutFlip(res.slide.id, commit)
      } else {
        commit()
      }
      touchDeckLocally()
      // Say what happened. The deck just gained slides on a button that said
      // "refine", so the notice names the slide it came from and the model's
      // reason for dividing it.
      if (split)
        showSplitNotice({
          number:
            (viewRef.current?.slides.findIndex(s => s.id === res.slide.id) ??
              0) + 1,
          count: split.added.length + 1,
          reason: split.reason,
        })
    } catch (error) {
      setImageError('Could not refine that slide — try again')
      // The dialog reports its own failure and stays open to retry.
      throw error
    } finally {
      setRefiningSlideId(null)
    }
  }

  /**
   * What the "refining" pill says: the slide's number and its title, so a
   * lecture-length deck shows WHICH slide is being worked on rather than only
   * that something is. A slide with no text yet falls back to the plain line.
   */
  const refiningMessage = (() => {
    if (!refiningSlideId) return ''
    const at = view.slides.findIndex(s => s.id === refiningSlideId)
    const slide = at === -1 ? undefined : view.slides[at]
    const title = slide?.title?.trim() ?? ''
    return !slide || !title
      ? t('refine.slide.running')
      : t('refine.slide.runningNamed', { number: at + 1, title })
  })()

  // The "Refine this slide" kebab item appears only when a slide-applicable
  // refine pass is enabled in the lecture's Refine settings (defaults on).
  const slideRefineEnabled =
    (view.deck.refineSlidesEnabled ?? true) ||
    (view.deck.refineTranscriptEnabled ?? true)

  // Slides whose original lecture audio the server said can be played back.
  const audioSlideIds = new Set(view.audioSlideIds ?? [])

  /** Whether a slide's transcript can be re-transcribed from its recorded
   * audio: the audio has to still be there AND the server has to hold the
   * speech engine (the keyless browser engine only runs during a live
   * session, so there is nothing to transcribe a recording with). */
  const canRegenerateTranscript = (slideId: string): boolean =>
    audioSlideIds.has(slideId) && getSttEngine() === 'google-cloud'

  // The slide whose spoken transcript is being edited (EDIT-6), plus its
  // 1-based number for the dialog heading. Missing (e.g. deleted meanwhile)
  // simply renders no dialog.
  const transcriptEditIndex = view.slides.findIndex(
    s => s.id === transcriptEditorFor,
  )
  const transcriptEditSlide =
    transcriptEditIndex >= 0 ? view.slides[transcriptEditIndex] : undefined

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
        {/* Project then lecture, both reachable: the project opens read-only
            for anyone when it is public (SOC-2 discovery).

            A narrow header gives way in a set order: the slide count and
            age beside this heading (1000), then this heading (100) — the
            project inside it (100) before the lecture's own title (1) —
            and the author last of all (1). Shrink factors do it: flexbox
            takes space from an item in proportion to its factor, so the
            bigger the factor the sooner that part is the one being
            trimmed. */}
        <h1 className="flex min-w-0 shrink-100 items-center gap-1.5 truncate">
          {view.project && (
            <>
              <Link
                to={`/app/projects/${view.project.id}`}
                className="min-w-0 shrink-100 truncate font-normal text-slate-500 hover:text-indigo-600"
              >
                {view.project.title?.trim() || untitledProject()}
              </Link>
              <span className="shrink-0 text-slate-300" aria-hidden>
                /
              </span>
            </>
          )}
          <span className="min-w-0 truncate">
            {canEdit ? (
              <EditableText
                value={view.deck.title}
                label="Lecture title"
                emptyDisplay={untitledLecture()}
                onSave={renameDeck}
                truncate
              />
            ) : (
              lectureTitle(view.deck)
            )}
          </span>
        </h1>
        <DeckTitleMeta
          deck={view.deck}
          count={view.slides.length}
          owner={view.owner}
        />
      </ShellTitle>

      {/* View toggle, settings, and share live in the primary nav (header),
          not the floating pill; settings sits after the view buttons, and
          share sits rightmost, to the right of the settings icon. */}
      <ShellActions>
        <ViewModeToggle mode={mode} onChange={setMode} />
        {translationAvailable && view.slides.length > 0 && (
          <SlideLanguageSwitcher
            source={sourceLocale}
            value={translation.locale}
            onChange={setSlideLanguage}
            busy={translation.busy}
            locked={!user}
            onLockedClick={() => setAuthGate('translation')}
          />
        )}
        {(canEdit || adminOverride) && (
          <Tooltip label={t('deck.settings.title')}>
            <button
              aria-label={t('deck.settings.title')}
              onClick={() => openSettings()}
              className="rounded-md p-2 text-slate-500 hover:text-slate-900"
            >
              <Settings className="h-5 w-5" aria-hidden />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('deck.share')} align="end">
          <button
            aria-label={t('deck.shareLabel')}
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
                    ? t('deck.play.empty')
                    : narrationPlaying
                      ? t('deck.play.pause')
                      : t('deck.play.hint')
                }
              >
                <button
                  aria-label={
                    narrationPlaying
                      ? t('deck.play.pause')
                      : t('deck.play.play')
                  }
                  aria-pressed={narrationPlaying}
                  disabled={view.slides.length === 0}
                  onClick={requestPlayback}
                  className={`rounded-md p-2 ${
                    narrationPlaying
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-slate-500 hover:text-slate-900'
                  } disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:text-slate-300`}
                >
                  {narrationPlaying ? (
                    <Pause className="h-5 w-5" aria-hidden />
                  ) : (
                    <Play className="h-5 w-5" aria-hidden />
                  )}
                </button>
              </Tooltip>
            )}
            {canEdit && (
              <>
                <Tooltip label={t('deck.addSlideHint')}>
                  <button
                    aria-label={t('deck.addSlide')}
                    onClick={() => void addSlide()}
                    className="rounded-md p-2 text-slate-500 hover:text-slate-900"
                  >
                    <Plus className="h-5 w-5" aria-hidden />
                  </button>
                </Tooltip>
                {SHOW_SEED_UPLOAD_IN_TOOLBAR && (
                  <Tooltip label={t('seed.materialHeading')}>
                    <button
                      aria-label={t('seed.dialog.addTitle')}
                      onClick={openManualSeed}
                      className="rounded-md p-2 text-slate-500 hover:text-slate-900"
                    >
                      <UploadCloud className="h-5 w-5" aria-hidden />
                    </button>
                  </Tooltip>
                )}
                {/* Speaking new slides into the deck is editing, so it is
                    held back with the rest of the editing surface while a
                    translation is shown: dictated slides would arrive in the
                    authored language and sit untranslated among the rest. */}
                {!showingTranslation && (
                  <Tooltip
                    label={
                      listening
                        ? t('deck.record.stopHint')
                        : t('deck.record.startHint')
                    }
                  >
                    <button
                      aria-label={t('deck.liveSession')}
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
                )}
              </>
            )}
          </>
        }
      />

      {/* Annotating is held back with editing while a translation is shown:
          a stroke placed over translated words would sit over different
          words the moment the reader switches back. */}
      {canEdit && !showingTranslation && view.slides.length > 0 && (
        <WhiteboardToolbar
          deckId={view.deck.id}
          whiteboard={whiteboard}
          onNewWhiteboardSlide={() => void addWhiteboardSlide()}
        />
      )}

      {/* Says plainly that these are not the lecturer's own words, and (for
          editors) why the editing surface has gone quiet. */}
      {showingTranslation && !translation.busy && (
        <NotificationPill
          action={{
            label: t('viewer.showOriginal'),
            onClick: () => translation.setLocale(null),
          }}
        >
          {canEdit
            ? t('viewer.translatedNoticeEditor')
            : t('viewer.translatedNotice')}
        </NotificationPill>
      )}
      {translation.failed && (
        <NotificationPill tone="error" role="alert">
          {/* An exhausted allowance is not an outage, and must not be reported
              as one: "try again" is wrong advice for something that cannot
              succeed until the plan changes (BILL-4). Only an editor sees it —
              they are the only person who can act on it — and only they get
              the upgrade path. A student keeps the neutral wording and learns
              nothing about the owner's plan. */}
          {translation.limitMessage && canEdit ? (
            <>
              {translation.limitMessage}{' '}
              <Link
                to="/app/plans"
                className="font-medium text-indigo-700 hover:underline"
              >
                {t('viewer.translationSeePlans')}
              </Link>
            </>
          ) : (
            t('viewer.translationFailed')
          )}
        </NotificationPill>
      )}
      {/* Narration stopped because the deck could not be spoken in the language
          it is being read in (PLAY-3). Said out loud rather than left as
          silence: a deck that simply stopped advancing would read as a broken
          player, and speaking it in the original would have the reader seeing
          one language and hearing another. */}
      {tts.error && (
        <NotificationPill
          tone="error"
          role="alert"
          action={{ label: t('common.dismiss'), onClick: tts.clearError }}
        >
          {t('viewer.narrationTranslationFailed')}
        </NotificationPill>
      )}

      {/* Quiet, neutral up/down vote (SOC-1): ▲ up-votes and ▼ down-votes side
          by side. In the content flow (right-aligned, under the view toggle),
          so it scrolls with the slides. Shown to signed-in viewers, not the
          owner — you do not vote on your own lecture. */}
      {status === 'authenticated' && !isOwner && (
        <div className="mb-4 flex justify-end">
          <VoteControl
            deckId={view.deck.id}
            up={view.voteUp}
            down={view.voteDown}
            myVote={view.myVote}
          />
        </div>
      )}

      {view.slides.length === 0 ? (
        canEdit ? (
          // With the live session open the mic is the next step, so the empty
          // deck says so; closing it again restores the "how to start" hint.
          speaking ? (
            <p className="text-center text-slate-400">
              {t('deck.empty.speaking')}
            </p>
          ) : (
            <p className="text-center text-slate-400">
              {/* Trans, not t: two icons sit inside the sentence, and the
                  order they fall in is the translator's call. */}
              <Trans
                i18nKey="deck.empty.howToStart"
                components={{
                  plus: (
                    <Plus
                      className="inline h-4 w-4 align-text-bottom"
                      aria-label={t('deck.empty.plusIcon')}
                    />
                  ),
                  mic: (
                    <Mic
                      className="inline h-4 w-4 align-text-bottom"
                      aria-label={t('deck.empty.micIcon')}
                    />
                  ),
                }}
              />
            </p>
          )
        ) : (
          <p className="text-center text-slate-400">{t('deck.empty.viewer')}</p>
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
              {/* The displayed slide may carry translated text; every
                  callback below still takes the authored slide, so editing,
                  narration and image work never see a translation. */}
              <SlideView
                slide={displaySlide(slide!)}
                template={view.template}
                editable={canEdit && !showingTranslation}
                onEdit={showingTranslation ? undefined : editSlide(slide!.id)}
                onReplaceImage={replaceSlideImage(slide!.id)}
                onPickImageCandidate={pickSlideImageCandidate(slide!.id)}
                onRemoveImage={removeSlideImage(slide!)}
                imagePending={pendingImages.has(slide!.id)}
              />
              <SlideMenu
                number={nav.current + 1}
                onSpeak={
                  ttsEnabled ? () => requestSpeakSlide(slide!) : undefined
                }
                onChangeLayout={
                  canEdit ? () => setLayoutPickerFor(slide!.id) : undefined
                }
                onEditTranscript={
                  canEdit ? () => setTranscriptEditorFor(slide!.id) : undefined
                }
                onRefine={
                  canEdit && slideRefineEnabled
                    ? () => setRefineSlideFor(slide!.id)
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
                  className={DEFER_OFFSCREEN}
                >
                  <SlideView
                    slide={displaySlide(s)}
                    template={view.template}
                    editable={!showingTranslation}
                    onEdit={showingTranslation ? undefined : editSlide(s.id)}
                    onReplaceImage={replaceSlideImage(s.id)}
                    onPickImageCandidate={pickSlideImageCandidate(s.id)}
                    onRemoveImage={removeSlideImage(s)}
                    imagePending={pendingImages.has(s.id)}
                  />
                  <SlideMenu
                    number={i + 1}
                    onSpeak={
                      ttsEnabled ? () => requestSpeakSlide(s) : undefined
                    }
                    onChangeLayout={() => setLayoutPickerFor(s.id)}
                    onEditTranscript={() => setTranscriptEditorFor(s.id)}
                    onRefine={
                      slideRefineEnabled
                        ? () => setRefineSlideFor(s.id)
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
                <li
                  key={s.id}
                  ref={nav.registerItem(i)}
                  className={`relative ${DEFER_OFFSCREEN}`}
                >
                  <SlideView slide={displaySlide(s)} template={view.template} />
                  {ttsEnabled && (
                    <SlideMenu
                      number={i + 1}
                      onSpeak={() => requestSpeakSlide(s)}
                    />
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

      {canEdit && transcriptEditSlide && (
        <TranscriptEditorModal
          slide={transcriptEditSlide}
          number={transcriptEditIndex + 1}
          canRegenerate={canRegenerateTranscript(transcriptEditSlide.id)}
          // Same gate the lecture's Refine settings put on the narration pass.
          canRefine={view.deck.refineTranscriptEnabled ?? true}
          // The app's one TTS controller, so previewing the edited text and
          // "Speak this slide" can never play at once.
          tts={ttsEnabled ? tts : undefined}
          onSaved={applySlide}
          onClose={() => setTranscriptEditorFor(null)}
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

      {canEdit && refineSlideFor && (
        <SlideRefineModal
          number={view.slides.findIndex(s => s.id === refineSlideFor) + 1 || 1}
          marked={hasVisibleDrawings(
            view.slides.find(s => s.id === refineSlideFor)?.drawings,
          )}
          hasAudio={audioSlideIds.has(refineSlideFor)}
          defaultLevel={
            view.deck.refineSlidesLevel ?? getRefineSlidesDefaultLevel()
          }
          defaultAllowSplit={view.deck.refineSplitEnabled ?? false}
          onRefine={options => refineSlide(refineSlideFor, options)}
          // Refining every slide is a lecture setting, so the blurb's link
          // swaps this dialog for the lecture's own Refine tab.
          onOpenLectureRefine={() => {
            setRefineSlideFor(null)
            openSettings('refine')
          }}
          onClose={() => setRefineSlideFor(null)}
        />
      )}

      {authGate && (
        <SignInDialog feature={authGate} onClose={() => setAuthGate(null)} />
      )}

      {editFailed && (
        <NotificationPill
          tone="error"
          role="alert"
          action={{
            label: '✕',
            ariaLabel: t('common.dismiss'),
            onClick: () => setEditFailed(false),
          }}
        >
          {t('deck.editFailed')}
        </NotificationPill>
      )}

      {refiningSlideId && (
        <NotificationPill>{refiningMessage}</NotificationPill>
      )}

      {splitNotice && (
        <NotificationPill
          action={{
            label: '✕',
            ariaLabel: t('common.dismiss'),
            onClick: () => setSplitNotice(null),
          }}
        >
          {splitNotice.reason
            ? t('refine.split.done', splitNotice)
            : t('refine.split.doneNoReason', splitNotice)}
        </NotificationPill>
      )}

      {refitUndo && (
        <NotificationPill
          action={{ label: t('common.undo'), onClick: undoRefit }}
        >
          {t('deck.layoutRefit')}
        </NotificationPill>
      )}

      {playingOriginalId && (
        <NotificationPill
          action={{ label: t('common.stop'), onClick: stopOriginalAudio }}
        >
          {t('deck.playingOriginal')}
        </NotificationPill>
      )}

      {generationPause && (
        <NotificationPill
          action={
            generationPause === 'paused'
              ? {
                  label: t('common.resume'),
                  onClick: () => resumeGeneration('manual'),
                }
              : undefined
          }
        >
          {generationPause === 'paused'
            ? t('deck.generation.paused')
            : t('deck.generation.resumed')}
        </NotificationPill>
      )}

      {imageError && (
        <NotificationPill
          tone="error"
          role="alert"
          action={{
            label: '✕',
            ariaLabel: t('common.dismiss'),
            onClick: () => setImageError(null),
          }}
        >
          {imageError}
        </NotificationPill>
      )}

      {(canEdit || adminOverride) &&
        settingsOpen &&
        !rightsPending &&
        !askAdmin && (
          <DeckSettingsModal
            deck={view.deck}
            projectGenerationFreedom={view.projectGenerationFreedom}
            projectTtsVoice={view.projectTtsVoice}
            initialTab={settingsTab ?? 'general'}
            isOwner={isOwner}
            projectTitle={view.project?.title}
            adminOverride={adminOverride}
            viewerIsAdmin={isAdmin === true}
            slidesHaveDrawings={view.slides.some(s =>
              hasVisibleDrawings(s.drawings),
            )}
            contentLocale={showingTranslation ? translation.locale! : undefined}
            onClose={closeSettings}
            onDeckChange={deck => setView(v => (v ? { ...v, deck } : v))}
            onDeleted={() => void navigate('/app')}
            onMoved={() => {
              // A move changes what the lecture inherits — the project in the
              // header, its AI freedom, language and voice — so reload the
              // view rather than patch the deck alone.
              apiFetch<DeckViewResponse>(`/api/decks/${slug}`)
                .then(setView)
                .catch(() => {
                  // Quiet failure: the current view stays until the next load
                })
            }}
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

      {askAdmin && (
        <ConfirmDialog
          title={t('deck.adminSettings.title')}
          message={t('deck.adminSettings.message', {
            name: lectureTitle(view.deck),
          })}
          confirmLabel={t('profile.adminSettings.confirm')}
          onConfirm={() => setAdminEditConfirmed(true)}
          onCancel={closeSettings}
        />
      )}

      {canEdit && speaking && (
        <>
          {/* Debug-only: typing phrases instead of speaking them. Hidden unless
              the server sets SIMULATED_SPEECH_ENABLED — real STT is the path
              users take. */}
          {simulatedSpeechEnabled && (
            <form
              onSubmit={onSpeak}
              aria-label={t('deck.liveSession')}
              className="mt-6 flex w-full gap-2"
            >
              <input
                ref={inputRef}
                value={phrase}
                onChange={e => setPhrase(e.target.value)}
                placeholder={
                  listening
                    ? t('deck.simulated.listening')
                    : t('deck.simulated.placeholder')
                }
                aria-label={t('deck.simulated.label')}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-3"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white disabled:opacity-50"
              >
                {busy
                  ? t('deck.simulated.generating')
                  : t('deck.simulated.speak')}
              </button>
            </form>
          )}
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
