/**
 * Keyboard toggling for full-screen slide viewing (PLAY-5): "f"/"F" with no
 * modifier, or Enter with Command/Control held, flips full screen on or off;
 * Escape leaves it (only while it is active). Mirrors useArrowKeys/
 * useBracketKeys — ignored while typing in an input, textarea, or
 * contenteditable, so the letter still reaches a field.
 */
import { useEffect } from 'react'
import { isTypingTarget } from './typingTarget'
import { isDragging } from './dragGuard'

/** A dialog (Modal.tsx `role`, either variant — including ConfirmDialog's
 * `alertdialog`) is open. All three shortcuts below skip while one is: an
 * open dialog owns the keyboard, and without this a stray "f" or
 * Command/Control-Enter typed into (or just pressed over) a dialog would
 * toggle full screen underneath it and remount the slide subtree — the
 * same trap Escape already had to avoid, just reachable through different
 * keys. */
const dialogOpen = (): boolean =>
  document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

export const useFullScreenKeys = ({
  active,
  onToggle,
  onExit,
}: {
  /** Whether full screen is currently on — gates Escape, which must never
   * fire when there is nothing to exit. */
  active: boolean
  onToggle: () => void
  onExit: () => void
}): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (dialogOpen()) return
      // A floating toolbar (the deck pill, the whiteboard toolbar) is
      // mid-drag: see dragGuard.ts for why toggling here would corrupt
      // whichever mode's remembered position the drag is writing to.
      if (isDragging()) return
      if (
        (event.key === 'f' || event.key === 'F') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        onToggle()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onToggle()
        return
      }
      if (event.key === 'Escape' && active) {
        // A leaf dialog (Modal.tsx) closes Escape on the CAPTURE phase and
        // stops it there, so listening on the bubble phase here already
        // means an open dialog's Escape never reaches this handler — its
        // stopPropagation cuts the event off before bubbling starts. The
        // dialogOpen() check above is kept as a second guard in case some
        // future dialog listens on bubble too (or a dialog opens without
        // going through Modal), so a dialog's Escape never doubles as an
        // exit from full screen.
        event.preventDefault()
        onExit()
      }
    }
    // Bubble phase (the default): see the comment above.
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onToggle, onExit])
}
