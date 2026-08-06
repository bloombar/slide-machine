/**
 * The way out of a surface that holds unsaved work.
 *
 * Three answers, in the order someone actually wants them: save it, throw it
 * away, or go back to what they were doing. A two-button "discard or cancel"
 * makes keeping the work the one thing the dialog cannot do, which is the
 * wrong shape for a question raised *because* there is work to lose.
 *
 * Focus lands on the safe option — going back — so a stray Enter cannot
 * discard anything.
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'

export default function UnsavedChangesDialog({
  title,
  message,
  saveLabel,
  discardLabel,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: {
  title: string
  message: string
  saveLabel: string
  discardLabel: string
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      role="alertdialog"
      ariaLabel={title}
      size="md"
      onClose={onCancel}
      initialFocusRef={cancelRef}
    >
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {/* Going back reads as the least consequential, so it sits furthest
            from the action people mean to take. */}
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
        >
          {discardLabel}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? t('common.saving') : saveLabel}
        </button>
      </div>
    </Modal>
  )
}
