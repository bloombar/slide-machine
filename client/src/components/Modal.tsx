/**
 * The single modal primitive every dialog builds on, so backdrop,
 * dismissal, focus, z-index, and panel chrome stay consistent.
 *
 * Two variants:
 *  - "center": a centered card (confirmations, small forms, pickers).
 *  - "sheet": a full-width sheet dropping from under the top nav (the
 *    lecture/project settings surfaces).
 *
 * Escape handling is configurable because nesting matters: a leaf dialog
 * closes on capture-phase Escape and stops it, so a ConfirmDialog opened
 * inside a settings sheet dismisses only itself. Container sheets listen
 * in the bubble phase (and ignore Escape while a field is focused), so a
 * nested capture-phase dialog always wins.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import Portal from './Portal'

/** True when the event targets a text field, so Escape shouldn't close. */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

/** max-width per size, for the centered variant. */
const SIZE_MAX_W = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

interface Props {
  onClose: () => void
  children: ReactNode
  /** Accessible name; use one of these two. */
  ariaLabel?: string
  ariaLabelledBy?: string
  role?: 'dialog' | 'alertdialog'
  variant?: 'center' | 'sheet'
  /** Centered variant only. */
  size?: keyof typeof SIZE_MAX_W
  /** Element focused on open; defaults to the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Extra classes for the panel (e.g. scroll caps). */
  className?: string
  closeOnEscape?: boolean
  /** Leaf dialogs capture Escape; container sheets listen on bubble. */
  escapeCapture?: boolean
  /** Sheets keep open when Escape is pressed inside a field. */
  escapeIgnoreTyping?: boolean
}

export default function Modal({
  onClose,
  children,
  ariaLabel,
  ariaLabelledBy,
  role = 'dialog',
  variant = 'center',
  size = 'sm',
  initialFocusRef,
  className = '',
  closeOnEscape = true,
  escapeCapture = true,
  escapeIgnoreTyping = false,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<Element | null>(null)

  // Focus goes into the dialog on open, so it has to come back out on close:
  // otherwise it lands on <body> and a keyboard user has to tab the whole
  // page again to reach the control they just pressed — which, for the
  // sign-in gate (AUTH-8), is exactly the control they are meant to press
  // again. Declared BEFORE the effect below so it records the trigger before
  // that one moves focus off it, and kept in its own effect with no deps so
  // a re-render (a new onClose identity, say) never restores mid-dialog.
  useEffect(() => {
    returnFocusTo.current = document.activeElement
    return () => {
      const back = returnFocusTo.current
      // Skip a trigger that closing removed from the page; focusing a
      // detached node silently does nothing anyway.
      if (back instanceof HTMLElement && back.isConnected) back.focus()
    }
  }, [])

  useEffect(() => {
    ;(initialFocusRef?.current ?? panelRef.current)?.focus()
    if (!closeOnEscape) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (escapeIgnoreTyping && isTypingTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handler, escapeCapture)
    return () => window.removeEventListener('keydown', handler, escapeCapture)
  }, [
    onClose,
    closeOnEscape,
    escapeCapture,
    escapeIgnoreTyping,
    initialFocusRef,
  ])

  const panelProps = {
    ref: panelRef,
    role,
    'aria-modal': true as const,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    tabIndex: -1,
  }

  if (variant === 'sheet') {
    return (
      <Portal>
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/30"
        />
        <div
          {...panelProps}
          className={`fixed inset-x-0 top-14 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-slate-200 bg-white p-6 shadow-xl focus:outline-none ${className}`}
        >
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </div>
      </Portal>
    )
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div
          aria-hidden
          onClick={onClose}
          className="absolute inset-0 bg-black/40"
        />
        <div
          {...panelProps}
          className={`relative w-full ${SIZE_MAX_W[size]} rounded-lg bg-white p-6 shadow-2xl focus:outline-none ${className}`}
        >
          {children}
        </div>
      </div>
    </Portal>
  )
}
