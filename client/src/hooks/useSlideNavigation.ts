/**
 * Shared slide navigation — ONE codebase for every deck/slide view
 * (viewer, editor, live session). Arrow keys and the chevron zones move
 * the current slide; in carousel mode that swaps the displayed slide,
 * in list mode the current slide scrolls into view.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useArrowKeys } from './useArrowKeys'
import type { ViewMode } from '../components/ViewModeToggle'

export function useSlideNavigation(count: number, mode: ViewMode) {
  const [current, setCurrent] = useState(0)
  const itemsRef = useRef(new Map<number, HTMLElement>())
  // Mode via ref: scrollTo is called from queued callbacks (mic-driven
  // generation) that may hold a closure from an earlier view mode
  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const goPrev = useCallback(() => setCurrent(c => Math.max(0, c - 1)), [])
  const goNext = useCallback(
    () => setCurrent(c => (count ? Math.min(count - 1, c + 1) : 0)),
    [count],
  )
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
