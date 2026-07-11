/**
 * Carousel/list view switcher shared by every deck/slide surface
 * (viewer, editor, session): carousel shows one slide with prev/next
 * navigation; list stacks all slides vertically, visible up-front.
 */
import { GalleryHorizontal, LayoutList } from 'lucide-react'

export type ViewMode = 'carousel' | 'list'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

const OPTIONS: Array<{
  mode: ViewMode
  label: string
  Icon: typeof LayoutList
}> = [
  { mode: 'carousel', label: 'Carousel view', Icon: GalleryHorizontal },
  { mode: 'list', label: 'List view', Icon: LayoutList },
]

export default function ViewModeToggle({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Slide view mode"
      className="flex items-center gap-1"
    >
      {OPTIONS.map(({ mode: target, label, Icon }) => (
        <button
          key={target}
          aria-label={label}
          aria-pressed={mode === target}
          onClick={() => onChange(target)}
          className={`rounded-md p-2 ${
            mode === target
              ? 'bg-indigo-50 text-indigo-600'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </button>
      ))}
    </div>
  )
}
