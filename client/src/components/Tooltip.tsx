/**
 * Small label shown beneath an icon-only control on hover, or when the
 * control is reached by keyboard, so the icons say what they do.
 * Decorative only: the control keeps its own aria-label, which is what
 * assistive tech reads, so the label here is hidden from it rather than
 * announced twice.
 */
import type { ReactNode } from 'react'

interface Props {
  /** Text shown on hover — keep it to a couple of words. */
  label: string
  /** Which side the label appears on; 'top' avoids clipping near a bottom edge. */
  side?: 'top' | 'bottom'
  /**
   * Horizontal anchoring of the label relative to the trigger. 'center'
   * (default) centres it; 'end' pins its right edge to the trigger so it
   * grows leftward — used for controls hugging a right edge, where a
   * centred label would overflow and be clipped.
   */
  align?: 'center' | 'start' | 'end'
  /** The control being described. */
  children: ReactNode
}

export default function Tooltip({
  label,
  side = 'bottom',
  align = 'center',
  children,
}: Props) {
  // Position the label above or below the trigger
  const place = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
  // Horizontal anchor: centre by default, or hug an edge so the label
  // grows inward instead of spilling past it
  const anchor =
    align === 'end'
      ? 'right-0'
      : align === 'start'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'
  return (
    // A NAMED group (group/tt): an unnamed group-hover uses a descendant
    // selector, so a tooltip nested inside another `group` (e.g. the image
    // slot) would light up whenever that outer group is hovered. Naming it
    // scopes the reveal to this trigger alone.
    <span className="group/tt relative inline-flex">
      {children}
      <span
        aria-hidden
        // focus-visible, not focus-within: clicking a button focuses it,
        // and focus-within would leave the label pinned open afterwards.
        // focus-visible fires for keyboard arrival only, matching how
        // SlideNavZones reveals its hotspots.
        className={`pointer-events-none absolute z-10 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 transition-opacity group-hover/tt:opacity-100 group-has-[:focus-visible]/tt:opacity-100 ${place} ${anchor}`}
      >
        {label}
      </span>
    </span>
  )
}
