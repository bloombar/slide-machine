/**
 * Undo and redo while editing a template.
 *
 * Modelled on the whiteboard's stroke history (DeckViewerPage): a snapshot is
 * taken at the *start* of a discrete action, not diffed out of every state
 * change. That is what makes a drag one undo step rather than forty — a
 * gesture writes new positions continuously, and only the caller knows where
 * one began.
 *
 * A snapshot holds the whole draft, including which layout and box were
 * selected. Undoing a deletion that leaves nothing selected is disorienting;
 * putting the selection back is most of what makes undo feel right.
 *
 * This is editor-local and pre-save. It reverses draft edits, never a saved
 * template — Cancel still discards everything.
 */
import { useCallback, useRef, useState } from 'react'

/** Deep enough that nobody hits it in a sitting, small enough that the drafts
 * held are never a memory concern — a template is a few kilobytes. */
const LIMIT = 50

/** How long a run of edits keeps folding into one step. Holding an arrow key
 * is one undo, and so is typing a word. */
const COALESCE_MS = 500

export interface DraftHistory {
  /** Takes a snapshot, if this is the start of a new action. Call it before
   * changing anything. */
  record: (key?: string) => void
  undo: () => boolean
  redo: () => boolean
  canUndo: boolean
  canRedo: boolean
  /** Forgets everything — a different template is being edited. */
  reset: () => void
}

export const useDraftHistory = <T>(
  current: () => T,
  restore: (draft: T) => void,
): DraftHistory => {
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const lastKey = useRef<{ key: string; at: number } | null>(null)
  // Only so the buttons can disable themselves; the stacks live in refs so a
  // snapshot mid-gesture does not re-render the canvas.
  const [depth, setDepth] = useState({ past: 0, future: 0 })

  const sync = useCallback(() => {
    setDepth({ past: past.current.length, future: future.current.length })
  }, [])

  const record = useCallback(
    (key?: string) => {
      // A keyed run — one field being typed in, one arrow key held down —
      // folds into the snapshot it started with until it pauses.
      if (key) {
        const now = Date.now()
        const last = lastKey.current
        if (last && last.key === key && now - last.at < COALESCE_MS) {
          lastKey.current = { key, at: now }
          return
        }
        lastKey.current = { key, at: now }
      } else {
        lastKey.current = null
      }
      past.current.push(current())
      if (past.current.length > LIMIT) past.current.shift()
      // A new edit forks history: what was undone is no longer ahead.
      future.current = []
      sync()
    },
    [current, sync],
  )

  const undo = useCallback(() => {
    const previous = past.current.pop()
    if (previous === undefined) return false
    future.current.push(current())
    lastKey.current = null
    restore(previous)
    sync()
    return true
  }, [current, restore, sync])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (next === undefined) return false
    past.current.push(current())
    lastKey.current = null
    restore(next)
    sync()
    return true
  }, [current, restore, sync])

  const reset = useCallback(() => {
    past.current = []
    future.current = []
    lastKey.current = null
    sync()
  }, [sync])

  return {
    record,
    undo,
    redo,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
    reset,
  }
}
