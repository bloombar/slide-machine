/**
 * The whiteboard layout: a blank slate with no content slots, meant as a
 * canvas for the whiteboard drawing tools (WB-1). The slide frame already
 * paints the themed background, so this renders an empty area — the paused-
 * generation notification (a NotificationPill) tells the user what it's for.
 * Requests no slots, matching its (empty) slot list in the template.
 */
export default function WhiteboardLayout() {
  return <div className="h-full w-full" />
}
