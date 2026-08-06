/**
 * "This design has been updated" — the offer, and the dialog that explains it
 * (TMPL-11).
 *
 * A lecture is drawn with the template version it pinned, so an edit to the
 * template — by its author, or by a deployment shipping a revised built-in —
 * never reaches it. This is where that edit is surfaced and, if the user
 * wants it, taken.
 *
 * The warning is specific rather than scary. The server reports which boxes
 * have nowhere to go once the update lands, counting only the ones some slide
 * actually fills, so a purely cosmetic change says exactly that and an update
 * that would empty a box names it. Nothing is deleted either way: unplaced
 * content stays on the slide and stops being drawn, which is what the dialog
 * says and what the server guarantees.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Deck, TemplateUpdateStatus } from '@slide-machine/shared'
import { RefreshCw } from 'lucide-react'
import { dispatchAction } from '../../api/actions'
import ConfirmDialog from '../ConfirmDialog'

export default function TemplateUpdateNotice({
  deckId,
  onApplied,
}: {
  deckId: string
  /** The lecture now sits on a new version; the caller reloads what it shows. */
  onApplied: (deck: Deck) => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<TemplateUpdateStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    dispatchAction<TemplateUpdateStatus>('deck.templateUpdateStatus', {
      deckId,
    })
      .then(setStatus)
      // A status that cannot be read is not worth an error in the user's
      // face: the lecture is fine, it simply is not being offered an update.
      .catch(() => setStatus(null))
  }, [deckId])

  useEffect(load, [load])

  const apply = () => {
    setBusy(true)
    setError(null)
    dispatchAction<Deck>('deck.applyTemplateUpdate', { deckId })
      .then(deck => {
        setConfirming(false)
        setStatus(null)
        onApplied(deck)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  if (!status?.available) return null

  const affected = status.affectedSlides
  const unplaced = status.impact.flatMap(i => i.unplaced)
  const removedLayouts = status.impact.filter(i => i.layoutRemoved)

  return (
    <>
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-amber-900">
              {t('template.update.heading')}
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              {affected === 0
                ? t('template.update.hintClean')
                : t('template.update.hintAffected', { count: affected })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t('template.update.apply')}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('template.update.confirmTitle')}
          confirmLabel={busy ? t('common.saving') : t('template.update.apply')}
          // Content moves between boxes; none of it is destroyed. A red
          // button would say otherwise.
          tone="neutral"
          onConfirm={apply}
          onCancel={() => setConfirming(false)}
          message={
            <>
              <p>{t('template.update.confirmIntro')}</p>
              {unplaced.length > 0 && (
                <>
                  <p className="mt-2">
                    {t('template.update.confirmUnplaced', {
                      count: affected,
                    })}
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {unplaced.map(label => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </>
              )}
              {removedLayouts.length > 0 && (
                <p className="mt-2">
                  {t('template.update.confirmRemovedLayouts', {
                    count: removedLayouts.reduce(
                      (sum, i) => sum + i.slideCount,
                      0,
                    ),
                  })}
                </p>
              )}
              <p className="mt-2">{t('template.update.confirmKept')}</p>
            </>
          }
        />
      )}
    </>
  )
}
