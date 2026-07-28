/**
 * Text-to-speech playback controller. Owns a single HTMLAudioElement and drives
 * three flows through one "only one thing plays at a time" state machine:
 *  - speakSlide(slide): speak one slide's stored narration/transcript (kebab
 *    option) — the same source as deck playback, just for a single slide.
 *  - playDeck(fromIndex): read the whole deck's stored transcript aloud,
 *    auto-advancing to each slide as it's spoken; Play↔Pause via toggle(), and
 *    skipTo(index) to follow the user's own slide navigation.
 *  - speakText(slide, text): speak words that are not saved yet, so the
 *    transcript editor can preview a narration before committing it (EDIT-6).
 *
 * They share one element deliberately: starting any of them silences the
 * others, so a preview can never play over "Speak this slide" or deck playback.
 * All stop the live mic first (never record while playing). A monotonically
 * increasing token cancels any in-flight sequence when a new one starts or on
 * stop/unmount — the same "start returns a cancel" shape as pollSlideImage.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Slide, TtsMark } from '@slide-machine/shared'
import { synthesizeSlideTts } from '../api/slides'

export type TtsStatus = 'idle' | 'playing' | 'paused'
/** What the active audio is: whole-deck playback, one slide's stored narration,
 * or a preview of unsaved text (EDIT-6). */
export type TtsScope = 'deck' | 'slide' | 'text' | null

interface Options {
  /** Current slides, read live (survives re-renders) — e.g. from a ref. */
  getSlides: () => Slide[]
  /** Move the carousel/list to a slide index (setCurrent + scrollTo). */
  navigate: (index: number) => void
  /** Stop the live STT session so we don't record while speaking. */
  stopMic: () => void
}

/** A live read of where playback is: which slide, and how far through its audio
 * (0..1), or null when the clip has no known duration. Read imperatively (e.g.
 * from a requestAnimationFrame loop) so callers can sync to it without a React
 * re-render every frame (WB-2). */
export interface TtsProgress {
  index: number
  fraction: number | null
  /** Seconds elapsed in the active clip, for mark-driven stroke sync (WB-2). */
  currentTime: number
  /** Total clip seconds, or null when unknown. */
  duration: number | null
  /** `<mark>` timepoints for the active slide's audio; empty when the voice /
   * engine couldn't emit them, so consumers fall back to `fraction`. */
  marks: TtsMark[]
}

export interface TtsPlayback {
  status: TtsStatus
  scope: TtsScope
  activeIndex: number | null
  playDeck: (fromIndex: number) => void
  /** Move deck playback to another slide (arrow-key navigation), continuing
   * from there. No-op unless deck playback is active. */
  skipTo: (index: number) => void
  speakSlide: (slide: Slide) => void
  /** Speak text that is not saved yet, as a preview (EDIT-6). */
  speakText: (slide: Slide, text: string) => void
  /** Toolbar play/pause: start deck playback, or pause/resume it. */
  toggle: (activeIndex: number) => void
  /** Pause or resume whatever is speaking, whichever flow started it. */
  pauseResume: () => void
  stop: () => void
  /** Live playback position for drawing-sync; null when nothing is playing. */
  getProgress: () => TtsProgress | null
}

export function useTtsPlayback({
  getSlides,
  navigate,
  stopMic,
}: Options): TtsPlayback {
  const [status, setStatus] = useState<TtsStatus>('idle')
  const [scope, setScope] = useState<TtsScope>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const tokenRef = useRef(0) // bumped to cancel any in-flight sequence
  const pausedRef = useRef(false)
  // Mirror of activeIndex for the imperative getProgress reader (WB-2), which
  // must not depend on a re-render to see the current slide.
  const activeIndexRef = useRef<number | null>(null)
  // Marks for the active clip, mirrored (like activeIndex) for the imperative
  // getProgress reader so stroke sync sees them without a re-render (WB-2).
  const marksRef = useRef<TtsMark[]>([])

  const ensureAudio = (): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio()
    return audioRef.current
  }

  /** Cancels any pending step and silences the element (no state reset). */
  const halt = useCallback(() => {
    tokenRef.current++
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.removeAttribute('src')
    }
  }, [])

  const stop = useCallback(() => {
    halt()
    pausedRef.current = false
    setStatus('idle')
    setScope(null)
    setActiveIndex(null)
    activeIndexRef.current = null
    marksRef.current = []
  }, [halt])

  /** Synthesizes via `fetchAudio`, then plays the clip on the shared element;
   * `onEnded` runs when it finishes (or there was nothing to play). Every flow
   * goes through here, so they cannot overlap or diverge in behavior. */
  const playSynthesized = useCallback(
    async (
      fetchAudio: () => Promise<{ url: string | null; marks?: TtsMark[] }>,
      token: number,
      onEnded: () => void,
    ) => {
      let url: string | null
      let marks: TtsMark[] = []
      try {
        const res = await fetchAudio()
        url = res.url
        marks = res.marks ?? []
      } catch {
        url = null
      }
      if (token !== tokenRef.current) return
      marksRef.current = marks
      if (!url) {
        onEnded() // nothing to speak → advance / finish
        return
      }
      const audio = ensureAudio()
      audio.src = url
      audio.onended = () => {
        if (token === tokenRef.current) onEnded()
      }
      if (pausedRef.current) {
        setStatus('paused') // paused mid-fetch — wait for resume
        return
      }
      try {
        await audio.play()
      } catch {
        if (token === tokenRef.current) onEnded()
        return
      }
      if (token === tokenRef.current) setStatus('playing')
    },
    [],
  )

  /** Navigates to a slide and speaks its stored narration. */
  const playAt = useCallback(
    async (
      index: number,
      mode: 'content' | 'transcript',
      token: number,
      onEnded: () => void,
    ) => {
      navigate(index)
      setActiveIndex(index)
      activeIndexRef.current = index
      const slide = getSlides()[index]
      if (!slide) {
        stop()
        return
      }
      await playSynthesized(
        () => synthesizeSlideTts(slide.id, mode),
        token,
        onEnded,
      )
    },
    [getSlides, navigate, playSynthesized, stop],
  )

  /** Runs the deck from `fromIndex`, speaking each slide in turn. `keepPaused`
   * leaves an already-paused deck paused (arrow-key skipping while paused):
   * the new slide's audio is fetched and cued, but waits for resume. */
  const runDeck = useCallback(
    (fromIndex: number, keepPaused: boolean) => {
      stopMic()
      halt()
      if (!keepPaused) pausedRef.current = false
      const token = ++tokenRef.current
      setScope('deck')
      setStatus(pausedRef.current ? 'paused' : 'playing')
      const count = getSlides().length
      const step = (i: number) => {
        if (token !== tokenRef.current) return
        if (i >= count) {
          stop()
          return
        }
        void playAt(i, 'transcript', token, () => step(i + 1))
      }
      step(Math.max(0, fromIndex))
    },
    [getSlides, halt, playAt, stop, stopMic],
  )

  const playDeck = useCallback(
    (fromIndex: number) => runDeck(fromIndex, false),
    [runDeck],
  )

  /**
   * Follows arrow-key navigation while the deck is being read aloud: the
   * narration jumps to the slide the user moved to instead of finishing the
   * one it was on. Ignored for the other flows (a single slide or an unsaved
   * preview isn't tied to where the deck is) and when nothing is playing.
   */
  const skipTo = useCallback(
    (index: number) => {
      if (scope !== 'deck' || status === 'idle') return
      runDeck(index, true)
    },
    [runDeck, scope, status],
  )

  const speakSlide = useCallback(
    (slide: Slide) => {
      stopMic()
      halt()
      pausedRef.current = false
      const token = ++tokenRef.current
      const index = getSlides().findIndex(s => s.id === slide.id)
      setScope('slide')
      setStatus('playing')
      // Speak the slide's stored narration/transcript (same as deck playback),
      // not the rendered text — the server narrates from content when a slide
      // has no transcript of its own.
      void playAt(index >= 0 ? index : 0, 'transcript', token, stop)
    },
    [getSlides, halt, playAt, stop, stopMic],
  )

  /**
   * Speaks text the user has not saved yet — the transcript editor's preview
   * (EDIT-6). Unlike the other flows it does not navigate: the editor is open
   * over the slide, and the preview is about the words, not where the deck is.
   * It also clears the active index, so whiteboard stroke sync (WB-2), which is
   * timed to a slide's real narration, never runs off a preview.
   */
  const speakText = useCallback(
    (slide: Slide, text: string) => {
      if (!text.trim()) return
      stopMic()
      halt()
      pausedRef.current = false
      const token = ++tokenRef.current
      setActiveIndex(null)
      activeIndexRef.current = null
      setScope('text')
      setStatus('playing')
      void playSynthesized(
        () => synthesizeSlideTts(slide.id, 'transcript', text),
        token,
        stop,
      )
    },
    [halt, playSynthesized, stop, stopMic],
  )

  const pauseResume = useCallback(() => {
    const audio = audioRef.current
    if (status === 'playing') {
      pausedRef.current = true
      audio?.pause()
      setStatus('paused')
    } else if (status === 'paused') {
      pausedRef.current = false
      void audio?.play()
      setStatus('playing')
    }
  }, [status])

  const toggle = useCallback(
    (idx: number) => {
      if (scope === 'deck' && status !== 'idle') pauseResume()
      else playDeck(idx)
    },
    [scope, status, pauseResume, playDeck],
  )

  const getProgress = useCallback((): TtsProgress | null => {
    const audio = audioRef.current
    const index = activeIndexRef.current
    if (!audio || index == null) return null
    const d = audio.duration
    const known = d && Number.isFinite(d) && d > 0
    const fraction = known
      ? Math.min(1, Math.max(0, audio.currentTime / d))
      : null
    return {
      index,
      fraction,
      currentTime: audio.currentTime,
      duration: known ? d : null,
      marks: marksRef.current,
    }
  }, [])

  // Stop + release on unmount.
  useEffect(() => () => halt(), [halt])

  return {
    status,
    scope,
    activeIndex,
    playDeck,
    skipTo,
    speakSlide,
    speakText,
    toggle,
    pauseResume,
    stop,
    getProgress,
  }
}
