/**
 * Space-bar narration play/pause: pressing Space toggles deck playback exactly
 * like the toolbar's play/pause button. Mirrors useArrowKeys/useBracketKeys —
 * presses are ignored while typing in an input, textarea, or contenteditable so
 * a space typed into a field never toggles playback. preventDefault stops the
 * page from scrolling and stops a focused play button from being re-clicked.
 *
 * When `enabled` is false the listener is not attached, so Space keeps its
 * normal browser behavior. The listener re-attaches when `onToggle` changes
 * (it closes over the current play/pause state), so it always toggles correctly.
 */
import { useEffect } from 'react'

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

export const useSpaceKey = (onToggle: () => void, enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onToggle, enabled])
}
