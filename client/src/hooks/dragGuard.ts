/**
 * Whether a floating toolbar (the deck pill, the whiteboard toolbar) is
 * mid-drag right now (PLAY-5). `useFullScreenKeys` checks this before
 * honoring "f" / Cmd-Enter / Escape: toggling full screen mid-drag
 * teleports whichever toolbar is being dragged to the OTHER mode's own
 * remembered spot without releasing the pointer, so the rest of the
 * gesture silently keeps writing into the mode the drag actually started
 * in — landing a position measured against stale geometry (wherever the
 * pointer ends up relative to a pill that already jumped away) in that
 * mode's storage. Ignoring the shortcuts for the drag's duration is
 * simpler and safer than trying to make a mid-gesture mode switch behave
 * sensibly. See docs/DECISIONS.md.
 *
 * A counter rather than a boolean: one physical pointer cannot really
 * drag two toolbars at once, but nothing forces exactly one `beginDrag`/
 * `endDrag` pair to be outstanding, and a counter stays correct even if
 * that ever changes (e.g. a second pointer on a touch device).
 */
let activeDrags = 0

/** Marks a drag as started. Call once a press has travelled far enough to
 * count as a drag, not on every pointerdown — a plain click never blocks
 * the shortcuts. */
export const beginDrag = (): void => {
  activeDrags += 1
}

/** Marks a drag as finished. Safe to call even if `beginDrag` was never
 * called for this gesture (a press that stayed a click) — the counter
 * never goes negative. */
export const endDrag = (): void => {
  activeDrags = Math.max(0, activeDrags - 1)
}

/** Whether any floating toolbar is mid-drag right now. */
export const isDragging = (): boolean => activeDrags > 0
