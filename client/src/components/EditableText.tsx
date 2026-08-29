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
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Portal from './Portal'

/** Space between the field and its hint, and from the viewport's edges. */
const HINT_GAP = 4

/** Narrow fields get a readable hint rather than one word per line. */
const HINT_MIN_WIDTH = 180

interface Props {
  value: string
  /** Accessible name, e.g. "Slide title" or "Bullet 2". */
  label: string
  onSave: (value: string) => void
  /** The value may hold line breaks of its own: Enter types one rather than
   * finishing the edit, and pasted newlines are kept rather than flattened
   * into spaces. Not what picks the element — every field that wraps is a
   * textarea, one-line values included. */
  multiline?: boolean
  /** Formatted display of the value; editing always shows the raw source. */
  renderValue?: (value: string) => ReactNode
  /** Shown (and read as the accessible name) when the value is empty,
   * e.g. "Untitled lecture"; editing still starts from the empty value. */
  emptyDisplay?: string
  /** Treat the emptyDisplay as a blank-slot placeholder: its text is
   * invisible (audiences see nothing) but still sizes the click target
   * and names the control; the box, its invitation and a skeleton
   * background appear on hover or under a data-reveal-blanks ancestor
   * (see index.css). */
  placeholderStyle?: boolean
  /** Debounce for auto-save while typing; overridable in tests. */
  debounceMs?: number
  /** Ellipsize the display when it outgrows the space it is given, for a
   * title in a narrow header. Off by default: text that wraps over several
   * lines (slide bullets) must keep wrapping. The field follows: a display
   * that ellipsizes is edited on one line, one that wraps is edited wrapped. */
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
  // Both elements are state, not refs, so the placement effect below re-runs
  // when they appear: a ref object is only ever filled in, and nothing
  // re-renders when it is.
  const [fieldEl, setFieldEl] = useState<
    HTMLInputElement | HTMLTextAreaElement | null
  >(null)
  const [hintEl, setHintEl] = useState<HTMLElement | null>(null)
  const [hintBox, setHintBox] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const hintId = useId()
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

  /*
   * Puts the hint under the field, in viewport coordinates.
   *
   * It is drawn through a portal (see the render below), so it has no ancestor
   * to be positioned against and no ancestor to be clipped by — which is the
   * point. Position: fixed, re-read whenever the field moves, whenever either
   * element resizes, and on any scroll, since the deck and the list view both
   * scroll under it.
   *
   * A layout effect: the placement has to be applied in the frame the hint
   * first paints, or it appears in the corner and jumps.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!editing || !hint || !fieldEl) return
    const place = () => {
      const box = fieldEl.getBoundingClientRect()
      const height = hintEl?.offsetHeight ?? 0
      // Under the field, unless the viewport has no room left there — a box
      // at the bottom of the screen puts its hint above itself instead.
      const below = box.bottom + HINT_GAP + height <= window.innerHeight
      setHintBox({
        top: below
          ? box.bottom + HINT_GAP
          : Math.max(HINT_GAP, box.top - HINT_GAP - height),
        left: box.left,
        width: box.width,
      })
    }
    place()
    const resize = new ResizeObserver(place)
    resize.observe(fieldEl)
    if (hintEl) resize.observe(hintEl)
    // Capturing, so a scroll in any container between here and the document
    // is seen and not just one on the window.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      resize.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [editing, hint, fieldEl, hintEl])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    ref: (node: HTMLInputElement | HTMLTextAreaElement | null) =>
      setFieldEl(node),
    // The hint is drawn elsewhere in the document, so the field has to name
    // it: a portal breaks the reading order that would otherwise carry it.
    'aria-describedby': hint ? hintId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      // A one-line value stays one line even when the field it is typed into
      // could hold two: pasting a paragraph into a title used to be flattened
      // by the input element itself, and a textarea does not do that for us.
      setDraft(
        multiline ? e.target.value : e.target.value.replace(/[\r\n]+/g, ' '),
      ),
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

  /*
   * A textarea unless the display truncates, whether or not the value is
   * multi-line.
   *
   * An input never wraps: a title that reads as three lines on the slide
   * straightened into one long line the moment it was clicked, scrolling
   * sideways under the cursor, and the box stopped looking like the box. A
   * textarea wraps the same text the same way, so what is being edited looks
   * like what was there. Only a box that ellipsizes keeps the input — that
   * display does not wrap either, so a wrapping field would misrepresent it.
   *
   * Rows: as many as the text has, no more. A floor of two made a one-line box
   * taller the moment it was clicked, which moves a box that centres its
   * contents, and `minHeight` already holds the space the display took —
   * including the height of its wrapping.
   */
  const field = truncate ? (
    <input {...sharedProps} />
  ) : (
    <textarea rows={Math.max(1, draft.split('\n').length)} {...sharedProps} />
  )
  if (!hint) return field
  /*
   * The hint is drawn OUT of the slide entirely, and placed over it.
   *
   * It cannot live in the box it describes. A slide box clips what it holds
   * (`overflow-hidden`) and is sized by its design, so a hint under a field
   * that already fills the box was cut in half or lost. Taking it out of the
   * flow was not enough either: absolutely positioned or not, it still counted
   * as the box's content, so `useFitText` saw a box overflowing by the height
   * of the hint and shrank the type to the floor to try to fit it — a box was
   * clipped AND its words went tiny the moment the cursor entered it.
   *
   * So it goes to the document root through a portal and is positioned against
   * the field's own rectangle. Nothing between it and the document can clip it
   * and nothing measures it, which is the whole of what it needs.
   *
   * It is chrome now rather than slide content: a fixed small size that stays
   * readable however small the slide is drawn, a dark chip so it reads over
   * any theme's background, and no pointer events — clicking it would blur the
   * field it describes and end the edit.
   */
  return (
    <>
      {field}
      <Portal>
        <span
          id={hintId}
          ref={setHintEl}
          className="pointer-events-none fixed z-20 rounded bg-slate-900/90 px-1.5 py-0.5 text-xs leading-snug text-white shadow-sm"
          style={{
            top: hintBox?.top ?? 0,
            left: hintBox?.left ?? 0,
            width: 'max-content',
            maxWidth: Math.max(hintBox?.width ?? 0, HINT_MIN_WIDTH),
            // Placed before it paints; until then it has nowhere to be.
            visibility: hintBox ? 'visible' : 'hidden',
          }}
        >
          {hint}
        </span>
      </Portal>
    </>
  )
}
