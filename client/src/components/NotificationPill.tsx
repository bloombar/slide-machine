/**
 * Floating status pill anchored to the bottom-center of the viewport — the
 * app's standard transient notification (refining a slide, playing original
 * audio, an image error, paused generation, …). Consolidates a style that was
 * repeated inline so every such notice looks and behaves the same, and new
 * ones can be added in one line.
 *
 * Visibility is the caller's concern: render the pill only while the notice
 * should show. An optional trailing action button lets a pill offer a control
 * (Stop, Resume, dismiss).
 */
import type { ReactNode } from 'react'

/** Neutral progress/info (dark) vs. an error (red). */
export type NotificationTone = 'neutral' | 'error'

interface PillAction {
  /** Button text, e.g. "Resume", "Stop", or "✕". */
  label: string
  onClick: () => void
  /** Accessible name when the label is a glyph (e.g. "Dismiss" for "✕"). */
  ariaLabel?: string
}

interface Props {
  /** Message shown in the pill. */
  children: ReactNode
  /** Colour intent; drives the background. Defaults to neutral. */
  tone?: NotificationTone
  /** ARIA live role: 'status' for progress/info, 'alert' for errors. */
  role?: 'status' | 'alert'
  /** Optional trailing action button. */
  action?: PillAction
}

/** A single bottom-center notification pill. */
export default function NotificationPill({
  children,
  tone = 'neutral',
  role = 'status',
  action,
}: Props) {
  return (
    <div className="fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
      <div
        role={role}
        className={`flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium text-white shadow-lg ${
          tone === 'error' ? 'bg-red-600' : 'bg-slate-800'
        }`}
      >
        {children}
        {action && (
          <button
            aria-label={action.ariaLabel}
            onClick={action.onClick}
            className="text-white/80 hover:text-white"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
