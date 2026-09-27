/**
 * Small confirmation dialog for destructive actions. Focus lands on
 * Cancel (the safe default); Escape cancels and, via Modal's capture-phase
 * handling, is captured before any underlying modal's own Escape handling.
 */
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'

interface Props {
  title: string
  /** Plain text, or any node — a settings confirm lists its changes. */
  message: ReactNode
  confirmLabel: string
  /**
   * How the confirm button reads. `danger` (the default) is for the
   * irreversible: deleting a template, a lecture, an account. `neutral` is for
   * a consequential-but-recoverable choice — taking a template update moves
   * content between boxes without destroying any of it, and a red button
   * would overstate that (TMPL-11).
   */
  tone?: 'danger' | 'neutral'
  /** Disables both buttons while the action it triggers is still in flight
   * (TMPL-28): confirm, so a slow request cannot be fired twice by an
   * impatient second click; cancel too, and Escape/backdrop with it, since
   * `onConfirm` and `onCancel` here both drive the same caller state (an
   * in-flight delete, say) and letting Cancel run concurrently with it
   * would race the two against each other for no reason a reader would
   * ever want. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { t } = useTranslation()

  return (
    <Modal
      role="alertdialog"
      ariaLabel={title}
      size="sm"
      onClose={busy ? () => {} : onCancel}
      initialFocusRef={cancelRef}
    >
      <h3 className="text-lg font-bold">{title}</h3>
      {/* A div, not a p: a change list renders a <ul> in here. */}
      <div className="mt-2 text-sm text-slate-600">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          ref={cancelRef}
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
            tone === 'neutral'
              ? 'bg-blue-600 hover:bg-blue-500'
              : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
