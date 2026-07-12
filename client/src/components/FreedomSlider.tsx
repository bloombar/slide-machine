/**
 * AI content-freedom slider (GEN-1), 1-10: 1 keeps slides to exactly
 * what the speaker said, 10 lets the AI elaborate freely. Used at both
 * levels — a lecture inherits its project's setting (and a project the
 * server default) until the slider is moved; "Use …" re-inherits,
 * storing nothing at this level again. Saves with the usual debounce.
 */
import { useEffect, useRef, useState } from 'react'
import {
  GENERATION_FREEDOM_MAX,
  GENERATION_FREEDOM_MIN,
} from '@slide-machine/shared'

interface Props {
  /** This level's own stored value; undefined while inheriting. */
  value?: number
  /** What applies while inheriting (for display). */
  inheritedValue: number
  /** Where the inherited value comes from, e.g. "project setting". */
  inheritedLabel: string
  /** A number sets this level's value; null re-inherits. */
  onChange: (value: number | null) => void
  debounceMs?: number
}

export default function FreedomSlider({
  value,
  inheritedValue,
  inheritedLabel,
  onChange,
  debounceMs = 500,
}: Props) {
  const target = value ?? inheritedValue
  const [draft, setDraft] = useState<number>(target)
  // Derived-state-from-props (the sanctioned render-time pattern):
  // follow external updates, e.g. a re-inherit resolved on the server
  const [lastTarget, setLastTarget] = useState<number>(target)
  if (target !== lastTarget) {
    setLastTarget(target)
    setDraft(target)
  }
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const slide = (next: number) => {
    setDraft(next)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => onChange(next), debounceMs)
  }

  const reset = () => {
    window.clearTimeout(timerRef.current)
    onChange(null)
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">Only what I say</span>
        <input
          type="range"
          min={GENERATION_FREEDOM_MIN}
          max={GENERATION_FREEDOM_MAX}
          step={1}
          value={draft}
          onChange={e => slide(Number(e.target.value))}
          aria-label="AI freedom"
          aria-valuetext={`${draft} of 10`}
          className="flex-1 accent-indigo-600"
        />
        <span className="text-xs text-slate-500">Free elaboration</span>
        <span className="w-10 text-right text-sm font-medium text-slate-700">
          {draft}/10
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {value === undefined ? (
          <>
            Using the {inheritedLabel} ({inheritedValue}/10) — move the slider
            to set it here.
          </>
        ) : (
          <>
            Set at this level.{' '}
            <button
              onClick={reset}
              className="cursor-pointer text-indigo-600 hover:underline"
            >
              Use {inheritedLabel}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
