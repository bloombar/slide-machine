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

  const goPrev = useCallback(() => setCurrent(c => Math.max(0, c - 1)), [])
  const goNext = useCallback(
    () => setCurrent(c => (count ? Math.min(count - 1, c + 1) : 0)),
    [count],
  )
  useArrowKeys(goPrev, goNext)

  // List view: navigating scrolls the now-current slide into view
  useEffect(() => {
    if (mode !== 'list') return
    itemsRef.current
      .get(current)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [current, mode])

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
    registerItem,
    hasPrev: current > 0,
    hasNext: current < count - 1,
  }
}
