/**
 * Pre-lecture (and mid-lecture) seeding dialog (SEED-1/SEED-2). Opening a
 * new lecture shows this first, so the instructor can add background notes
 * and upload documents/images before speaking; the same dialog reopens
 * from the toolbar to add material during the lecture. Everything saved
 * here writes to the deck's own seed store, so it also appears under
 * Lecture settings — it is the same data, one place to edit it.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { Deck } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import Portal from './Portal'

interface Props {
  deck: Deck
  /** 'prelecture' opens before recording; 'manual' opens during it. */
  mode: 'prelecture' | 'manual'
  /** Skip/close in prelecture proceeds to recording; Done in manual just closes. */
  onClose: () => void
  /** Reflects a saved seed-notes change back to the deck. */
  onDeckChange: (deck: Deck) => void
}

export default function SeedDialog({
  deck,
  mode,
  onClose,
  onDeckChange,
}: Props) {
  const { t } = useTranslation()
  const prelecture = mode === 'prelecture'

  // Escape closes, matching the other dialogs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <Portal>
      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div
          aria-hidden
          onClick={onClose}
          className="absolute inset-0 bg-black/30"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('seed.dialog.addTitle')}
          className="relative max-h-[calc(100vh-4rem)] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        >
          <header className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">
                {prelecture
                  ? t('seed.dialog.addTitle')
                  : t('seed.materialHeading')}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {prelecture
                  ? t('seed.dialog.prelectureHint')
                  : t('seed.dialog.manualHint')}
              </p>
            </div>
            <button
              aria-label={t('common.close')}
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 font-semibold text-slate-700">
                {t('seed.notesHeading')}
              </h3>
              <SeedNotesEditor
                value={deck.seedContext ?? ''}
                label={t('deck.settings.general.seedNotesLabel')}
                placeholder={t('deck.settings.general.seedNotesPlaceholder')}
                onSave={seedContext => {
                  dispatchAction<Deck>('deck.setSeedNotes', {
                    deckId: deck.id,
                    seedContext,
                  })
                    .then(onDeckChange)
                    .catch(() => {
                      // Quiet failure: the next keystroke retries
                    })
                }}
              />
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-slate-700">
                {t('seed.materialHeading')}
              </h3>
              <SeedMaterial projectId={deck.projectId} deckId={deck.id} />
            </div>
          </div>

          <footer className="mt-6 flex justify-end gap-2">
            {prelecture ? (
              <>
                <button
                  onClick={onClose}
                  className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('seed.dialog.skip')}
                </button>
                <button
                  onClick={onClose}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
                >
                  {t('seed.dialog.start')}
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
              >
                {t('common.done')}
              </button>
            )}
          </footer>
        </div>
      </div>
    </Portal>
  )
}
