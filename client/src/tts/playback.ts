/**
 * Text-to-speech playback controller. Owns a single HTMLAudioElement and drives
 * two flows through one "only one thing plays at a time" state machine:
 *  - speakSlide(slide): speak one slide's rendered content (kebab option).
 *  - playDeck(fromIndex): read the whole deck's stored transcript aloud,
 *    auto-advancing to each slide as it's spoken; Play↔Pause via toggle().
 *
 * Both stop the live mic first (never record while playing). A monotonically
 * increasing token cancels any in-flight sequence when a new one starts or on
 * stop/unmount — the same "start returns a cancel" shape as pollSlideImage.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Slide } from '@slide-machine/shared'
import { synthesizeSlideTts } from '../api/slides'

export type TtsStatus = 'idle' | 'playing' | 'paused'
export type TtsScope = 'deck' | 'slide' | null

interface Options {
  /** Current slides, read live (survives re-renders) — e.g. from a ref. */
  getSlides: () => Slide[]
  /** Move the carousel/list to a slide index (setCurrent + scrollTo). */
  navigate: (index: number) => void
  /** Stop the live STT session so we don't record while speaking. */
  stopMic: () => void
}

export interface TtsPlayback {
  status: TtsStatus
  scope: TtsScope
  activeIndex: number | null
  playDeck: (fromIndex: number) => void
  speakSlide: (slide: Slide) => void
  /** Toolbar play/pause: start deck playback, or pause/resume it. */
  toggle: (activeIndex: number) => void
  stop: () => void
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
  }, [halt])

  /** Navigates to a slide, synthesizes its audio, and plays it; `onEnded`
   * runs when the clip finishes (or there was nothing to play). */
  const playAt = useCallback(
    async (
      index: number,
      mode: 'content' | 'transcript',
      token: number,
      onEnded: () => void,
    ) => {
      navigate(index)
      setActiveIndex(index)
      const slide = getSlides()[index]
      if (!slide) {
        stop()
        return
      }
      let url: string | null
      try {
        url = (await synthesizeSlideTts(slide.id, mode)).url
      } catch {
        url = null
      }
      if (token !== tokenRef.current) return
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
    [getSlides, navigate, stop],
  )

  const playDeck = useCallback(
    (fromIndex: number) => {
      stopMic()
      halt()
      pausedRef.current = false
      const token = ++tokenRef.current
      setScope('deck')
      setStatus('playing')
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

  const speakSlide = useCallback(
    (slide: Slide) => {
      stopMic()
      halt()
      pausedRef.current = false
      const token = ++tokenRef.current
      const index = getSlides().findIndex(s => s.id === slide.id)
      setScope('slide')
      setStatus('playing')
      void playAt(index >= 0 ? index : 0, 'content', token, stop)
    },
    [getSlides, halt, playAt, stop, stopMic],
  )

  const toggle = useCallback(
    (idx: number) => {
      const audio = audioRef.current
      if (scope === 'deck' && status === 'playing') {
        pausedRef.current = true
        audio?.pause()
        setStatus('paused')
      } else if (scope === 'deck' && status === 'paused') {
        pausedRef.current = false
        void audio?.play()
        setStatus('playing')
      } else {
        playDeck(idx)
      }
    },
    [scope, status, playDeck],
  )

  // Stop + release on unmount.
  useEffect(() => () => halt(), [halt])

  return { status, scope, activeIndex, playDeck, speakSlide, toggle, stop }
}
