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
 *
 * Deck playback prefetches: as soon as a slide's narration starts, the next
 * slide's clip is synthesized and downloaded into memory, so the hand-off at
 * the end of a slide is a memory read instead of a server round trip plus a
 * download (PLAY-1) — that wait was audible as a gap between slides.
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

/** A synthesized clip that is ready to play. `playUrl` is what the element
 * gets: a blob URL when the bytes were pulled into memory first, otherwise the
 * server URL (the element then downloads it itself, as before). */
interface Clip {
  playUrl: string | null
  /** The in-memory blob URL, when one was made — revoked once it's spent. */
  objectUrl: string | null
  marks: TtsMark[]
}

/** Stands in for a clip with nothing to speak (or one that failed to load). */
const EMPTY_CLIP: Clip = { playUrl: null, objectUrl: null, marks: [] }

/** Cache key for a slide's clip: the same words are the same audio. */
const clipKey = (slideId: string, mode: 'content' | 'transcript'): string =>
  `${slideId}|${mode}`

/**
 * Downloads a clip's bytes and wraps them in an object URL so playing it costs
 * no network. Returns null when that isn't possible (fetch blocked by CORS on
 * an off-origin bucket, or no Blob URL support), leaving the caller with the
 * plain URL — the audio still plays, just without the head start.
 */
const toObjectUrl = async (url: string): Promise<string | null> => {
  if (typeof URL?.createObjectURL !== 'function') return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch {
    return null
  }
}

/** Synthesizes a clip and pulls its audio into memory. */
const loadClip = async (
  slideId: string,
  mode: 'content' | 'transcript',
  text?: string,
): Promise<Clip> => {
  const { url, marks } =
    text === undefined
      ? await synthesizeSlideTts(slideId, mode)
      : await synthesizeSlideTts(slideId, mode, text)
  if (!url) return EMPTY_CLIP
  const objectUrl = await toObjectUrl(url)
  return { playUrl: objectUrl ?? url, objectUrl, marks: marks ?? [] }
}

/** Frees a clip's in-memory bytes once nothing can play them. */
const releaseClip = (clip: Clip): void => {
  if (clip.objectUrl && typeof URL?.revokeObjectURL === 'function') {
    URL.revokeObjectURL(clip.objectUrl)
  }
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
  // The next slide's clip, loading or loaded ahead of time (deck playback).
  const prefetchRef = useRef<{ key: string; clip: Promise<Clip> } | null>(null)
  // Blob URL backing whatever is on the element now, so it can be freed when
  // the next clip takes its place.
  const activeObjectUrlRef = useRef<string | null>(null)

  const ensureAudio = (): HTMLAudioElement => {
    if (!audioRef.current) audioRef.current = new Audio()
    return audioRef.current
  }

  /** Frees the bytes of the clip that was playing. */
  const releaseActive = () => {
    if (
      activeObjectUrlRef.current &&
      typeof URL?.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(activeObjectUrlRef.current)
    }
    activeObjectUrlRef.current = null
  }

  /** Throws away a prefetched clip nothing is going to play. */
  const dropPrefetch = useCallback(() => {
    const pending = prefetchRef.current
    prefetchRef.current = null
    if (pending) void pending.clip.then(releaseClip, () => {})
  }, [])

  /** Cancels any pending step and silences the element (no state reset). A
   * prefetched clip survives: skipping slides mid-deck restarts the sequence,
   * and the slide skipped to may well be the one already warmed. */
  const halt = useCallback(() => {
    tokenRef.current++
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.removeAttribute('src')
    }
    releaseActive()
  }, [])

  const stop = useCallback(() => {
    halt()
    dropPrefetch()
    pausedRef.current = false
    setStatus('idle')
    setScope(null)
    setActiveIndex(null)
    activeIndexRef.current = null
    marksRef.current = []
  }, [dropPrefetch, halt])

  /** Loads the clip via `getClip`, then plays it on the shared element;
   * `onEnded` runs when it finishes (or there was nothing to play). Every flow
   * goes through here, so they cannot overlap or diverge in behavior. */
  const playSynthesized = useCallback(
    async (
      getClip: () => Promise<Clip>,
      token: number,
      onEnded: () => void,
    ) => {
      let clip: Clip
      try {
        clip = await getClip()
      } catch {
        clip = EMPTY_CLIP
      }
      if (token !== tokenRef.current) {
        releaseClip(clip) // superseded before it could play
        return
      }
      marksRef.current = clip.marks
      releaseActive() // the previous clip is done with
      activeObjectUrlRef.current = clip.objectUrl
      if (!clip.playUrl) {
        onEnded() // nothing to speak → advance / finish
        return
      }
      const audio = ensureAudio()
      audio.src = clip.playUrl
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

  /**
   * Uses the prefetched clip when it is the one about to play; otherwise the
   * prefetch was for a slide we're no longer heading to, so it is discarded
   * and the clip loads normally.
   */
  const takeClip = useCallback(
    (key: string, load: () => Promise<Clip>): Promise<Clip> => {
      const pending = prefetchRef.current
      if (pending?.key === key) {
        prefetchRef.current = null
        return pending.clip
      }
      dropPrefetch()
      return load()
    },
    [dropPrefetch],
  )

  /**
   * Starts synthesizing and downloading a slide's narration before it is its
   * turn, so deck playback doesn't stall at the transition. Cheap to repeat:
   * a clip already warmed for that slide is left alone, and the server caches
   * synthesis by content hash, so nothing is paid for twice.
   */
  const prefetch = useCallback(
    (index: number) => {
      const slide = getSlides()[index]
      if (!slide) return
      const key = clipKey(slide.id, 'transcript')
      if (prefetchRef.current?.key === key) return
      dropPrefetch()
      const clip = loadClip(slide.id, 'transcript')
      // Failures are handled where the clip is played (it advances instead);
      // this keeps the wait from looking like an unhandled rejection.
      clip.catch(() => {})
      prefetchRef.current = { key, clip }
    },
    [dropPrefetch, getSlides],
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
        () => takeClip(clipKey(slide.id, mode), () => loadClip(slide.id, mode)),
        token,
        onEnded,
      )
    },
    [getSlides, navigate, playSynthesized, stop, takeClip],
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
        // Once this slide is actually speaking, warm the next one so the
        // hand-off doesn't wait on the network.
        void playAt(i, 'transcript', token, () => step(i + 1)).then(() => {
          if (token === tokenRef.current && i + 1 < count) prefetch(i + 1)
        })
      }
      step(Math.max(0, fromIndex))
    },
    [getSlides, halt, playAt, prefetch, stop, stopMic],
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
        () => loadClip(slide.id, 'transcript', text),
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

  // Stop + release on unmount, including any clip warmed but never played.
  useEffect(
    () => () => {
      halt()
      dropPrefetch()
    },
    [dropPrefetch, halt],
  )

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
