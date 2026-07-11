/**
 * Shared header for every deck/slide page (viewer, session): centered
 * lecture title with the carousel/list toggle on the left and
 * page-specific actions on the right. At very narrow widths the title
 * sits on its own row above a toggle/actions row.
 */
import type { ReactNode } from 'react'
import ViewModeToggle, { type ViewMode } from './ViewModeToggle'

interface Props {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  title: ReactNode
  actions?: ReactNode
}

export default function DeckPageHeader({
  mode,
  onModeChange,
  title,
  actions,
}: Props) {
  return (
    <header className="mb-4 flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-center">
      <h1 className="text-center text-lg font-semibold text-slate-700 sm:col-start-2 sm:row-start-1">
        {title}
      </h1>
      {/* Narrow: one row under the title; sm+: contents places the
          children into the outer grid's side columns */}
      <div className="flex items-center justify-between sm:contents">
        <div className="sm:col-start-1 sm:row-start-1 sm:justify-self-start">
          <ViewModeToggle mode={mode} onChange={onModeChange} />
        </div>
        <div className="flex items-center justify-end gap-1 sm:col-start-3 sm:row-start-1">
          {actions}
        </div>
      </div>
    </header>
  )
}
