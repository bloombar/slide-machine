/**
 * The building blocks of every "Refine with AI" surface (GEN-4), so the
 * lecture-wide tab and the per-slide dialog present the same controls the same
 * way — one checkbox-with-explanation, one strength slider.
 *
 * `SLIDE_REFINE_PARTS` names the three separable aspects of a slide the content
 * pass can change; both surfaces offer all three. Breaking a slide into several
 * is offered beside them as its own checkbox (`RefineSplitOption`), because it
 * changes how many slides the lecture has rather than what one slide says.
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

interface SplitProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Which surface is asking, so the label can say "this slide" where only
   * one slide is in scope. */
  scope: 'slide' | 'lecture'
  /** True when the text pass is off. Splitting is a claim about a slide's
   * words — that they are two ideas, or more than one slide can hold — and a
   * refine that is not reading the words cannot make it, so the option goes
   * unavailable rather than quietly doing nothing. */
  textOff?: boolean
}

/**
 * "Break a slide up when it needs it" (GEN-4).
 *
 * Permission granted before the run, not a question afterwards: a refine that
 * has this ticked writes the split itself. So the explanation has to carry the
 * reassurance that ticking it is not a promise to divide anything — most
 * slides come back as one, and the model is told to keep them that way unless
 * splitting is genuinely necessary.
 */
export function RefineSplitOption({
  checked,
  onChange,
  scope,
  textOff,
}: SplitProps) {
  const { t } = useTranslation()
  return (
    <RefineOption
      label={t(
        scope === 'slide' ? 'refine.split.labelSlide' : 'refine.split.label',
      )}
      description={
        <>
          {t(
            scope === 'slide'
              ? 'refine.split.descriptionSlide'
              : 'refine.split.description',
          )}
          {textOff && ` ${t('refine.split.needsText')}`}
        </>
      }
      // Shown off while unavailable, so the box never claims something the
      // run will not do.
      checked={checked && !textOff}
      onChange={onChange}
      disabled={textOff}
    />
  )
}
