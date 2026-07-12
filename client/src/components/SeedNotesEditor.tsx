/**
 * Auto-saving textarea for seed notes (PROJ-1/SEED-1): free-form
 * background material that biases slide generation. Saves with the
 * usual debounce; blur flushes immediately. Failures are quiet — the
 * text simply stays put and the next keystroke retries.
 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  label: string
  placeholder?: string
  onSave: (value: string) => void
  debounceMs?: number
}

export default function SeedNotesEditor({
  value,
  label,
  placeholder,
  onSave,
  debounceMs = 800,
}: Props) {
  const [text, setText] = useState(value)
  const savedRef = useRef(value)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const save = (next: string) => {
    if (next === savedRef.current) return
    savedRef.current = next
    onSave(next)
  }

  const onChange = (next: string) => {
    setText(next)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => save(next), debounceMs)
  }

  return (
    <textarea
      value={text}
      onChange={e => onChange(e.target.value)}
      onBlur={() => {
        window.clearTimeout(timerRef.current)
        save(text)
      }}
      aria-label={label}
      placeholder={placeholder}
      rows={5}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
    />
  )
}
