/**
 * Arrow-key slide navigation (PLAY-1), shared by every deck/slide view:
 * left/up go to the previous slide, right/down to the next. Handled keys
 * are prevented from also scrolling the page natively. Key presses are
 * ignored while typing in an input, textarea, or contenteditable so
 * caret movement never flips slides.
 */
import { useEffect } from 'react'
import { isTypingTarget } from './typingTarget'

export const useArrowKeys = (onPrev: () => void, onNext: () => void): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        onPrev()
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext])
}
