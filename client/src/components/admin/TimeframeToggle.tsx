/**
 * The Current billing period / All time switch shared by the admin usage and
 * cost panels. One component so the two panels beside each other name the
 * same windows with the same words — an operator comparing them should never
 * wonder whether "period" means something different a heading away.
 */
import type { UsageWindow } from '@slide-machine/shared'

export default function TimeframeToggle({
  value,
  onChange,
}: {
  value: UsageWindow
  onChange: (window: UsageWindow) => void
}) {
  const button = (window: UsageWindow, label: string) => (
    <button
      type="button"
      aria-pressed={value === window}
      onClick={() => onChange(window)}
      className={`rounded-md px-2 py-1 text-xs font-medium ${
        value === window
          ? 'bg-slate-200 text-slate-800'
          : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      role="group"
      aria-label="Timeframe"
      className="flex gap-1 rounded-lg border border-slate-200 p-0.5"
    >
      {button('period', 'Current billing period')}
      {button('all', 'All time')}
    </div>
  )
}
