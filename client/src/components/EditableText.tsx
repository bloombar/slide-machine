/**
 * Generalizable in-place text editing: click any text node to edit it
 * where it stands, inheriting the surrounding typography. Changes
 * auto-save through a debounced onSave while typing (the app-wide
 * pattern); blur or Enter flushes immediately, Escape reverts — including
 * undoing any interim debounced save.
 *
 * `renderValue` lets the display show a formatted view (e.g. rendered
 * Markdown) while the field edits the raw source. The display box is
 * measured on entry and reserved as the field's minimum size, so
 * swapping between the two never shifts the slide layout.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  value: string
  /** Accessible name, e.g. "Slide title" or "Bullet 2". */
  label: string
  onSave: (value: string) => void
  multiline?: boolean
  /** Formatted display of the value; editing always shows the raw source. */
  renderValue?: (value: string) => ReactNode
  /** Shown (and read as the accessible name) when the value is empty,
   * e.g. "Untitled lecture"; editing still starts from the empty value. */
  emptyDisplay?: string
  /** Debounce for auto-save while typing; overridable in tests. */
  debounceMs?: number
}

export default function EditableText({
  value,
  label,
  onSave,
  multiline = false,
  renderValue,
  emptyDisplay,
  debounceMs = 800,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [reservedBox, setReservedBox] = useState<{
    w: number
    h: number
  } | null>(null)
  const displayRef = useRef<HTMLSpanElement>(null)
  const originalRef = useRef(value)
  const lastSavedRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const save = (next: string) => {
    if (next === lastSavedRef.current) return
    lastSavedRef.current = next
    onSave(next)
  }

  // Debounced auto-save while typing
  useEffect(() => {
    if (!editing || draft === lastSavedRef.current) return
    timerRef.current = setTimeout(() => save(draft), debounceMs)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, editing, debounceMs])

  const startEditing = () => {
    // Reserve the rendered box so the source field can't shrink the layout
    const el = displayRef.current
    setReservedBox(el ? { w: el.offsetWidth, h: el.offsetHeight } : null)
    originalRef.current = value
    lastSavedRef.current = value
    setDraft(value)
    setEditing(true)
  }

  const finish = () => {
    clearTimeout(timerRef.current)
    setEditing(false)
    save(draft)
  }

  const cancel = () => {
    clearTimeout(timerRef.current)
    setEditing(false)
    // Undo any interim debounced save
    save(originalRef.current)
    setDraft(originalRef.current)
  }

  if (!editing) {
    return (
      <span
        ref={displayRef}
        role="button"
        tabIndex={0}
        // The text itself stays the accessible name (an aria-label would
        // mask it from AT and heading queries); the hint rides on title.
        // Empty values get an explicit name so the control stays
        // reachable — unless emptyDisplay already provides visible text
        aria-label={value || emptyDisplay ? undefined : `Edit ${label}`}
        title={`Click to edit ${label}`}
        onClick={startEditing}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            startEditing()
          }
        }}
        // relative z-10 lifts the text above SlideNavZones' overlay
        // hotspots, so clicking text edits instead of navigating
        className="relative z-10 -mx-1 inline-block cursor-text rounded px-1 hover:bg-black/5"
      >
        {value
          ? (renderValue?.(value) ?? value)
          : (emptyDisplay ?? renderValue?.(value) ?? value)}
      </span>
    )
  }

  const sharedProps = {
    value: draft,
    autoFocus: true,
    'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: finish,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        finish()
      }
    },
    // Outline (not border) marks the field: outlines paint outside the
    // box model, so entering/leaving edit mode never shifts the layout
    className:
      'relative z-10 -mx-1 w-full resize-none rounded bg-transparent px-1 outline-1 outline-offset-2 outline-current/40 outline-solid',
    style: {
      font: 'inherit',
      color: 'inherit',
      textAlign: 'inherit',
      letterSpacing: 'inherit',
      minWidth: reservedBox?.w,
      minHeight: reservedBox?.h,
    } as React.CSSProperties,
  }

  return multiline ? (
    <textarea rows={Math.max(2, draft.split('\n').length)} {...sharedProps} />
  ) : (
    <input {...sharedProps} />
  )
}
