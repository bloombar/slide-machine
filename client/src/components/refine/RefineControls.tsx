/**
 * The building blocks of every "Refine with AI" surface (GEN-4), so the
 * lecture-wide tab and the per-slide dialog present the same controls the same
 * way — one checkbox-with-explanation, one strength slider.
 *
 * `SLIDE_REFINE_PARTS` names the three separable aspects of a slide the content
 * pass can change. The per-slide dialog offers all three today; the
 * lecture-wide tab still refines a slide wholesale, and can adopt the same list
 * (and the same `SlideRefineParts` payload) whenever it grows the split.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SlideRefineParts } from '@slide-machine/shared'

interface OptionProps {
  label: string
  description: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** A refine toggle: title, one line of plain explanation, and the checkbox. */
export function RefineOption({
  label,
  description,
  checked,
  onChange,
  disabled,
}: OptionProps) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-1"
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        <span className="block text-slate-500">{description}</span>
      </span>
    </label>
  )
}

interface LevelProps {
  value: number
  onChange: (value: number) => void
  /** Accessible name — says what this strength applies to. */
  ariaLabel: string
  /** Indent under the checkbox it belongs to (the lecture tab's per-pass
   * sliders); off for a slider that governs the whole dialog. */
  indented?: boolean
}

/** How much to refine, 1 (light) – 5 (substantial). */
export function RefineLevelSlider({
  value,
  onChange,
  ariaLabel,
  indented,
}: LevelProps) {
  const { t } = useTranslation()
  return (
    <label
      className={`flex items-center gap-3 text-sm text-slate-600 ${
        indented ? 'mt-2 ms-7' : ''
      }`}
    >
      {t('refine.howMuch', { level: value })}
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        aria-label={ariaLabel}
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  )
}

/**
 * The content pass's three aspects, in the order they are offered. These
 * are the same field names the server takes, so a surface renders this
 * list and sends the object straight through — and each one also keys its
 * own copy under `refine.parts.<key>` in the locale bundles.
 */
export const SLIDE_REFINE_PARTS: Array<keyof SlideRefineParts> = [
  'text',
  'layout',
  'imagery',
]

interface PartsProps {
  value: Required<SlideRefineParts>
  onChange: (value: Required<SlideRefineParts>) => void
}

/** The three content-pass toggles as a group; reusable by any refine surface. */
export function RefinePartsOptions({ value, onChange }: PartsProps) {
  const { t } = useTranslation()
  return (
    <>
      {SLIDE_REFINE_PARTS.map(part => (
        <RefineOption
          key={part}
          label={t(`refine.parts.${part}.label`)}
          description={t(`refine.parts.${part}.description`)}
          checked={value[part]}
          onChange={checked => onChange({ ...value, [part]: checked })}
        />
      ))}
    </>
  )
}
