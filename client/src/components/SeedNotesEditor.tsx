/**
 * Auto-saving textarea for seed notes (PROJ-1/SEED-1): free-form
 * background material that biases slide generation. Saves with the
 * usual debounce; blur and unmount both flush immediately. Failures are
 * quiet — the text simply stays put and the next keystroke retries.
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
  // The latest text and the latest save, for the unmount flush: it runs
  // once with whatever the last render left behind, so it cannot read
  // either from the closure it was created in.
  const textRef = useRef(value)
  const flushRef = useRef<() => void>(() => {})

  const save = (next: string) => {
    if (next === savedRef.current) return
    savedRef.current = next
    onSave(next)
  }

  // Refreshed after every render, so the unmount flush below always calls
  // the current `onSave` rather than the one from the first render
  useEffect(() => {
    flushRef.current = () => save(textRef.current)
  })

  // Closing the dialog mid-debounce must not lose the last keystrokes:
  // typing a note and starting the lecture straight away is the normal
  // way to use the seed dialog, and dropping the timer silently binned
  // everything typed in the last debounce window.
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      flushRef.current()
    },
    [],
  )

  const onChange = (next: string) => {
    setText(next)
    textRef.current = next
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
