/**
 * A one-line "live transcript" readout: the words currently being spoken (or
 * narrated), echoed under the current slide. Two behaviours matter more than
 * the styling:
 *
 * 1. It reserves the same box — one line-height — whether or not there is
 *    text, so the page never shifts as a phrase starts, grows, or clears.
 *    That means this element is *always* mounted; the caller does not
 *    conditionally render it based on whether there is anything to show.
 * 2. A phrase longer than the line never wraps, and for live speech the
 *    *end* of the phrase (the most recently spoken words) is what matters,
 *    so overflow must be clipped from the front, not the back. CSS
 *    `text-overflow: ellipsis` only ever clips the tail, so instead this
 *    lays the text out right-to-left (`direction: rtl`) while the text
 *    content itself is untouched — the browser then anchors rendering to
 *    the box's trailing edge and clips whatever does not fit off the front.
 *    This is the same trick browsers use to show the end of a long URL.
 *
 * A later slice reuses this for narration subtitles during playback, so the
 * props are kept to what that caller will need (styling hooks) rather than
 * anything specific to how the text arrives.
 */
interface TranscriptSubtitleProps {
  /** The words to display. Empty string reserves the box but shows nothing. */
  text: string
  /** Extra classes merged onto the box, for a caller-specific position. */
  className?: string
  /** data-testid on the box, so callers/tests can target it directly. */
  testId?: string
}

export default function TranscriptSubtitle({
  text,
  className = '',
  testId,
}: TranscriptSubtitleProps) {
  return (
    <p
      // Live region for screen readers, same as the block this replaces.
      // Because the element is always mounted, an empty `text` never causes
      // a live-region "appeared" announcement — only an actual change to
      // non-empty content is announced.
      aria-live="polite"
      data-testid={testId}
      className={`mt-2 w-full overflow-hidden text-sm text-slate-400 italic ${className}`}
      style={{
        // Fixed height (not "auto"), so the box does not collapse when
        // `text` is empty — this is what keeps the page from jumping.
        // 1.25rem matches text-sm's default line-height (leading-5).
        height: '1.25rem',
        whiteSpace: 'nowrap',
        // The front-clipping trick described above: lay the box out RTL so
        // overflow is cropped from the start, then pin the (LTR) text back
        // to the box's start edge so it still reads left-to-right.
        direction: 'rtl',
        textAlign: 'left',
      }}
    >
      {text}
    </p>
  )
}
