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
  /** Treat the emptyDisplay as a blank-slot placeholder: its text is
   * invisible (audiences see nothing) but still sizes the click target
   * and names the control; a skeleton background appears on hover or
   * under a data-reveal-blanks ancestor (see index.css). */
  placeholderStyle?: boolean
  /** Debounce for auto-save while typing; overridable in tests. */
  debounceMs?: number
  /** Ellipsize the display when it outgrows the space it is given, for a
   * title in a narrow header. Off by default: text that wraps over several
   * lines (slide bullets) must keep wrapping. Editing is unaffected. */
  truncate?: boolean
  /**
   * Edit the value as source rather than as prose (EDIT-7): a monospaced
   * field with spelling and autocorrect off, and tabs typed into the text
   * instead of moving focus.
   *
   * A program listing is not language. Autocorrect turns a quote into a
   * curly quote and the program stops running; a spelling underline says a
   * variable name is wrong when it is the only name that works.
   */
  source?: boolean
  /**
   * What the template meant this box for, shown while it is being filled
   * (EDIT-7/TMPL-10).
   *
   * Only while editing: an instructor typing into "Worked example" wants to
   * know it should be eight lines of runnable Python, and an audience does
   * not want a line of instructions under every box on the slide.
   */
  hint?: string
  /**
   * Make the whole box the click target rather than just the words in it.
   *
   * A table cell is a box an author aims at — clicking its padding, or
   * anywhere in an empty one, has to start an edit. Text in a slide layout is
   * the opposite: its clickable area should hug the words, or it would sit
   * over whatever is beside it.
   */
  fill?: boolean
}

export default function EditableText({
  value,
  label,
  onSave,
  multiline = false,
  renderValue,
  emptyDisplay,
  placeholderStyle = false,
  debounceMs = 800,
  truncate = false,
  source = false,
  hint,
  fill = false,
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
        // hotspots, so clicking text edits instead of navigating.
        // The hover background normally bleeds a little past the text
        // (px-1 with -mx-1 back out, so the layout is unmoved); a
        // truncating box gives that up, since padding inside a capped
        // width would ellipsize text that in fact fits. It is a block, not
        // an inline-block: hidden overflow makes an inline-block sit on the
        // line by its bottom edge, which lifts the text off the baseline of
        // whatever is beside it.
        className={`relative z-10 cursor-text rounded hover:bg-black/5 ${
          fill
            ? 'block h-full w-full'
            : truncate
              ? 'block max-w-full truncate'
              : '-mx-1 inline-block px-1'
        } ${!value && emptyDisplay && placeholderStyle ? 'slot-blank' : ''}`}
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
    // Source is typed, not dictated to: no spelling underlines, no smart
    // quotes, no capitalising the first letter of a line of Python.
    ...(source
      ? {
          spellCheck: false,
          autoCorrect: 'off' as const,
          autoCapitalize: 'off' as const,
          autoComplete: 'off' as const,
        }
      : {}),
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
      ...(source
        ? {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            // Indentation is the content: never reflow it.
            whiteSpace: 'pre' as const,
            textAlign: 'start' as const,
          }
        : {}),
    } as React.CSSProperties,
  }

  const field = multiline ? (
    <textarea rows={Math.max(2, draft.split('\n').length)} {...sharedProps} />
  ) : (
    <input {...sharedProps} />
  )
  if (!hint) return field
  return (
    <span className="inline-block w-full">
      {field}
      <span className="mt-[0.6cqi] block text-[1.4cqi] leading-snug opacity-60">
        {hint}
      </span>
    </span>
  )
}
