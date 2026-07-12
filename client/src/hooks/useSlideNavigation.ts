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
    registerItem,
    hasPrev: current > 0,
    hasNext: current < count - 1,
  }
}
