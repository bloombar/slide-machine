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
  return (
    <label
      className={`flex items-center gap-3 text-sm text-slate-600 ${
        indented ? 'mt-2 ml-7' : ''
      }`}
    >
      How much: {value}
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

/** One separable aspect of a slide, as offered in the UI. */
interface PartDescriptor {
  key: keyof SlideRefineParts
  label: string
  description: string
}

/**
 * The content pass's three aspects, in the order they are offered. Keyed by the
 * same field names the server takes, so a surface renders this list and sends
 * the object straight through.
 */
export const SLIDE_REFINE_PARTS: PartDescriptor[] = [
  {
    key: 'text',
    label: 'Refine slide text',
    description: 'Rewrite the wording to present the content better.',
  },
  {
    key: 'layout',
    label: 'Refine slide layout',
    description:
      'Move the slide to a layout that suits it better, keeping everything it shows.',
  },
  {
    key: 'imagery',
    label: 'Refine slide imagery',
    description:
      'Find a picture when the layout has an image slot and none is placed.',
  },
]

interface PartsProps {
  value: Required<SlideRefineParts>
  onChange: (value: Required<SlideRefineParts>) => void
}

/** The three content-pass toggles as a group; reusable by any refine surface. */
export function RefinePartsOptions({ value, onChange }: PartsProps) {
  return (
    <>
      {SLIDE_REFINE_PARTS.map(part => (
        <RefineOption
          key={part.key}
          label={part.label}
          description={part.description}
          checked={value[part.key]}
          onChange={checked => onChange({ ...value, [part.key]: checked })}
        />
      ))}
    </>
  )
}
