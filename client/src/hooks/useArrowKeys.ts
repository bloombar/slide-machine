/**
 * Left/right arrow-key slide navigation (PLAY-1). Ignores key presses
 * while the user is typing in an input, textarea, or contenteditable so
 * caret movement never flips slides.
 */
import { useEffect } from 'react'

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

export const useArrowKeys = (onPrev: () => void, onNext: () => void): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === 'ArrowLeft') onPrev()
      else if (event.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext])
}
