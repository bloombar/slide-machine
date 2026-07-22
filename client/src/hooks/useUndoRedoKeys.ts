/**
 * Undo/redo keyboard shortcuts for whiteboard drawing (WB): Cmd/Ctrl-Z undoes
 * the last mark on the slide being edited; Cmd/Ctrl-Shift-Z and Ctrl-Y redo it.
 * Mirrors useArrowKeys/useSpaceKey — presses are ignored while typing in an
 * input, textarea, or contenteditable so a field's own undo keeps working.
 *
 * `onUndo`/`onRedo` return whether they actually changed anything; the browser's
 * native undo is only suppressed (preventDefault) when there was a whiteboard
 * edit to reverse, so an empty history leaves Cmd-Z untouched. When `enabled`
 * is false the listener is not attached at all.
 */
import { useEffect } from 'react'

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

export const useUndoRedoKeys = (
  onUndo: () => boolean,
  onRedo: () => boolean,
  enabled: boolean,
): void => {
  useEffect(() => {
    if (!enabled) return
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      // The platform undo modifier: Cmd on macOS, Ctrl elsewhere.
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      // Ctrl-Y is the Windows-style redo alternative to Cmd/Ctrl-Shift-Z.
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y'
      const isUndo = key === 'z' && !event.shiftKey
      if (!isRedo && !isUndo) return
      const changed = isRedo ? onRedo() : onUndo()
      if (changed) event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onUndo, onRedo, enabled])
}
