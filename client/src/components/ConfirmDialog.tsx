/**
 * Small confirmation dialog for destructive actions. Focus lands on
 * Cancel (the safe default); Escape cancels and, via Modal's capture-phase
 * handling, is captured before any underlying modal's own Escape handling.
 */
import { useRef } from 'react'
import Modal from './Modal'

interface Props {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      role="alertdialog"
      ariaLabel={title}
      size="sm"
      onClose={onCancel}
      initialFocusRef={cancelRef}
    >
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button
          ref={cancelRef}
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
