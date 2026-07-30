/**
 * Color + thickness picker for a drawing tool (WB-1), expanded by pressing and
 * holding the pen or highlighter button. Pops out horizontally beside the
 * button; outside-click or Escape closes it. Opacity is fixed by the tool (pen
 * opaque, highlighter translucent), so only color and thickness are offered.
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolStyle } from './useWhiteboard'

interface Props {
  label: string
  colors: string[]
  thicknesses: number[]
  value: ToolStyle
  onChange: (style: ToolStyle) => void
  onClose: () => void
}

export default function ColorThicknessPopover({
  label,
  colors,
  thicknesses,
  value,
  onChange,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  // Always offer the current color as a swatch, so a template default that
  // isn't in the preset list still shows as selected.
  const swatches = colors.includes(value.color)
    ? colors
    : [value.color, ...colors]

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Defer so the opening press-hold pointerup doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('whiteboard.picker.label', { tool: label })}
      // Pops out to the right of the vertical toolbar.
      className="absolute top-0 start-full z-30 ms-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-1.5">
        {swatches.map(color => (
          <button
            key={color}
            aria-label={t('whiteboard.picker.color', { color })}
            aria-pressed={value.color === color}
            onClick={() => onChange({ ...value, color })}
            className={`h-5 w-5 rounded-full border ${
              value.color === color
                ? 'ring-2 ring-indigo-500 ring-offset-1'
                : 'border-slate-300'
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <div className="h-5 w-px bg-slate-200" aria-hidden />
      <div className="flex items-center gap-2">
        {thicknesses.map((thickness, i) => (
          <button
            key={thickness}
            aria-label={t('whiteboard.picker.thickness', { step: i + 1 })}
            aria-pressed={value.thickness === thickness}
            onClick={() => onChange({ ...value, thickness })}
            className={`flex h-6 w-6 items-center justify-center rounded-md ${
              value.thickness === thickness
                ? 'bg-indigo-50 ring-2 ring-indigo-500'
                : 'hover:bg-slate-100'
            }`}
          >
            <span
              className="block rounded-full bg-slate-700"
              // Preview dot scales with the preset; capped so the largest fits.
              style={{
                width: Math.min(18, 6 + i * 5),
                height: Math.min(18, 6 + i * 5),
              }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
