/**
 * Toolbar for the deck viewer: carousel/list toggle on the left and
 * page-specific actions on the right. The lecture title itself lives in
 * the primary nav (via ShellTitle), not here.
 */
import type { ReactNode } from 'react'
import ViewModeToggle, { type ViewMode } from './ViewModeToggle'

interface Props {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  actions?: ReactNode
}

export default function DeckPageHeader({ mode, onModeChange, actions }: Props) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <ViewModeToggle mode={mode} onChange={onModeChange} />
      <div className="flex items-center justify-end gap-1">{actions}</div>
    </header>
  )
}
