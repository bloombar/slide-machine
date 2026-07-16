/**
 * AI content-freedom slider (GEN-1), 1-5: 1 keeps slides to exactly
 * what the speaker said, 5 lets the AI elaborate freely. Used at both
 * levels — a lecture inherits its project's setting (and a project the
 * server default) until the slider is moved; "Reset to default"
 * appears only once a value is set here, and re-inherits (storing
 * nothing at this level again). Saves with the usual debounce.
 */
import { useEffect, useRef, useState } from 'react'
import {
  GENERATION_FREEDOM_MAX,
  GENERATION_FREEDOM_MIN,
} from '@slide-machine/shared'

interface Props {
  /** This level's own stored value; undefined while inheriting. */
  value?: number
  /** What applies while inheriting (positions the slider). */
  inheritedValue: number
  /** A number sets this level's value; null resets to the default. */
  onChange: (value: number | null) => void
  debounceMs?: number
}

export default function FreedomSlider({
  value,
  inheritedValue,
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
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={GENERATION_FREEDOM_MIN}
            max={GENERATION_FREEDOM_MAX}
            step={1}
            value={draft}
            onChange={e => slide(Number(e.target.value))}
            aria-label="AI freedom"
            aria-valuetext={`${draft} of 5`}
            className="w-full accent-indigo-600"
          />
          {/* Light tick scale; inset to sit under the thumb centers */}
          <div
            aria-hidden
            className="flex justify-between px-[7px] text-[10px] leading-none text-slate-300 select-none"
          >
            {Array.from(
              { length: GENERATION_FREEDOM_MAX - GENERATION_FREEDOM_MIN + 1 },
              (_, i) => (
                <span key={i}>{GENERATION_FREEDOM_MIN + i}</span>
              ),
            )}
          </div>
        </div>
        <span className="text-xs text-slate-500">Free elaboration</span>
      </div>
      {value !== undefined && (
        <p className="mt-1 text-xs">
          <button
            onClick={reset}
            className="cursor-pointer text-indigo-600 hover:underline"
          >
            Reset to default
          </button>
        </p>
      )}
    </div>
  )
}
