/**
 * Shared slide navigation — ONE codebase for every deck/slide view
 * (viewer, editor, live session). Arrow keys and the chevron zones move
 * the current slide; in carousel mode that swaps the displayed slide,
 * in list mode the current slide scrolls into view. An optional `onNavigate`
 * is called with the new index whenever such a move happens, so callers can
 * follow along — deck TTS uses it to skip the narration to that slide.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useArrowKeys } from './useArrowKeys'
import type { ViewMode } from '../components/ViewModeToggle'

export function useSlideNavigation(
  count: number,
  mode: ViewMode,
  onNavigate?: (index: number) => void,
) {
  const [current, setCurrent] = useState(0)
  const itemsRef = useRef(new Map<number, HTMLElement>())
  // Always-fresh mirror of `current` (goPrev/goNext report the index they land
  // on) and of the callback, so neither goes stale in the key handler.
  const currentRef = useRef(0)
  const countRef = useRef(count)
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => {
    currentRef.current = current
    countRef.current = count
    onNavigateRef.current = onNavigate
  })
  // Mode via ref: scrollTo is called from queued callbacks (mic-driven
  // generation) that may hold a closure from an earlier view mode
  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  /** Moves one slide and reports the landing index; a move that would run past
   * either end changes nothing, so nothing is reported. */
  const step = useCallback((delta: number) => {
    const last = countRef.current ? countRef.current - 1 : 0
    const next = Math.max(0, Math.min(last, currentRef.current + delta))
    if (next === currentRef.current) return
    currentRef.current = next
    setCurrent(next)
    onNavigateRef.current?.(next)
  }, [])

  const goPrev = useCallback(() => step(-1), [step])
  const goNext = useCallback(() => step(1), [step])
  useArrowKeys(goPrev, goNext)

  // List view: prev/next navigation centers the now-current slide
  useEffect(() => {
    if (mode !== 'list') return
    itemsRef.current
      .get(current)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [current, mode])

  /** List view: bring a slide into view even when its index is already
   * current (e.g. a generation update landing on the same slide). */
  const scrollTo = useCallback((index: number) => {
    if (modeRef.current !== 'list') return
    itemsRef.current
      .get(index)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [])

  /**
   * List view: the index of the slide the user is actually looking at —
   * the registered item whose center is nearest the viewport center, or
   * null when none is on screen. Used instead of `current` (which only
   * moves on explicit navigation) so an action never targets a slide the
   * user has scrolled away from.
   */
  const visibleIndex = useCallback((): number | null => {
    const viewportCenter = window.innerHeight / 2
    let best: { index: number; distance: number } | null = null
    for (const [index, el] of itemsRef.current) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter)
      if (!best || distance < best.distance) best = { index, distance }
    }
    return best ? best.index : null
  }, [])

  /** Ref callback for list items so navigation can scroll to them. */
  const registerItem = useCallback(
    (index: number) =>
      (el: HTMLElement | null): void => {
        if (el) itemsRef.current.set(index, el)
        else itemsRef.current.delete(index)
      },
    [],
  )

  return {
    current,
    setCurrent,
    goPrev,
    goNext,
    scrollTo,
    visibleIndex,
    registerItem,
    hasPrev: current > 0,
    hasNext: current < count - 1,
  }
}
