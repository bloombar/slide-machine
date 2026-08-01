/**
 * Carousel/list view switcher shared by every deck/slide surface
 * (viewer, editor, session): carousel shows one slide with prev/next
 * navigation; list stacks all slides vertically, visible up-front. The
 * two sit inside one rounded rectangle, so they read as one control for
 * switching views rather than two loose icons; the active view is
 * highlighted.
 */
import { useTranslation } from 'react-i18next'
import { List, RectangleHorizontal } from 'lucide-react'
import Tooltip from './Tooltip'

export type ViewMode = 'carousel' | 'list'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

/** The two views, with the bundle key naming each. */
const OPTIONS: Array<{
  mode: ViewMode
  labelKey: string
  Icon: typeof List
}> = [
  {
    mode: 'carousel',
    labelKey: 'deck.view.carousel',
    Icon: RectangleHorizontal,
  },
  { mode: 'list', labelKey: 'deck.view.list', Icon: List },
]

export default function ViewModeToggle({ mode, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('deck.view.label')}
      className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5"
    >
      {OPTIONS.map(({ mode: target, labelKey, Icon }) => (
        <Tooltip key={target} label={t(labelKey)}>
          <button
            aria-label={t(labelKey)}
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
