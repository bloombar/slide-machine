/**
 * Carousel/list view switcher shared by every deck/slide surface
 * (viewer, editor, session): carousel shows one slide with prev/next
 * navigation; list stacks all slides vertically, visible up-front. The
 * two sit inside one rounded rectangle, so they read as one control for
 * switching views rather than two loose icons; the active view is
 * highlighted.
 */
import { List, RectangleHorizontal } from 'lucide-react'
import Tooltip from './Tooltip'

export type ViewMode = 'carousel' | 'list'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

const OPTIONS: Array<{
  mode: ViewMode
  label: string
  Icon: typeof List
}> = [
  { mode: 'carousel', label: 'Carousel view', Icon: RectangleHorizontal },
  { mode: 'list', label: 'List view', Icon: List },
]

export default function ViewModeToggle({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Slide view mode"
      className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5"
    >
      {OPTIONS.map(({ mode: target, label, Icon }) => (
        <Tooltip key={target} label={label}>
          <button
            aria-label={label}
            aria-pressed={mode === target}
            onClick={() => onChange(target)}
            // The two icons sit inside one rounded rectangle; the active
            // view is simply highlighted in indigo. Kept a notch smaller
            // than the page actions (settings/add/record), which use h-5.
            className={`rounded-md p-1 ${
              mode === target
                ? 'bg-indigo-50 text-indigo-600'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
