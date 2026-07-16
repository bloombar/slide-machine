/**
 * Bracket-key layout cycling (EDIT-3): "]" steps the active slide to the
 * next layout, "[" to the previous. Mirrors useArrowKeys — key presses
 * are ignored while typing in an input, textarea, or contenteditable so
 * brackets typed into a field never change a layout.
 */
import { useEffect } from 'react'

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

export const useBracketKeys = (
  onPrev: () => void,
  onNext: () => void,
): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === '[') {
        event.preventDefault()
        onPrev()
      } else if (event.key === ']') {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext])
}
