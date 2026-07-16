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
  /** The control being described. */
  children: ReactNode
}

export default function Tooltip({ label, children }: Props) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        aria-hidden
        // focus-visible, not focus-within: clicking a button focuses it,
        // and focus-within would leave the label pinned open afterwards.
        // focus-visible fires for keyboard arrival only, matching how
        // SlideNavZones reveals its hotspots.
        className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
