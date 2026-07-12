/**
 * Per-slide layout picker (EDIT-3): the deck template's layouts as a
 * card grid, current one highlighted; picking dispatches
 * slide.setLayout and closes. Escape or the backdrop closes without
 * changing anything.
 */
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { Template } from '@slide-machine/shared'

interface Props {
  template: Template
  current: string
  onPick: (layoutType: string) => void
  onClose: () => void
}

export default function LayoutPickerModal({
  template,
  current,
  onPick,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Change slide layout"
        className="relative max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl"
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">Change slide layout</h3>
          <button
            ref={closeRef}
            aria-label="Close layout picker"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div
          role="radiogroup"
          aria-label="Slide layout"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {template.layouts.map(layout => {
            const selected = layout.type === current
            return (
              <button
                key={layout.type}
                role="radio"
                aria-checked={selected}
                onClick={() => onPick(layout.type)}
                className={`rounded-md border px-4 py-3 text-left ${
                  selected
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="block text-sm font-medium">
                  {layout.label}
                </span>
                <span className="block text-xs text-slate-500">
                  {layout.purpose}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
