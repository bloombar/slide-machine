/**
 * Shared header for every deck/slide page (viewer, editor, session):
 * carousel/list toggle on the left, centered lecture title, and
 * page-specific actions on the right.
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
    <header className="mb-4 grid grid-cols-3 items-center">
      <ViewModeToggle mode={mode} onChange={onModeChange} />
      <h1 className="text-center text-lg font-semibold text-slate-700">
        {title}
      </h1>
      <div className="flex items-center justify-end gap-1">{actions}</div>
    </header>
  )
}
