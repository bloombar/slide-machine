/**
 * Creating a lecture from a Google Slides presentation (EXP-5).
 *
 * The design import (TMPL-8) takes a deck and keeps only its look. This keeps
 * the slides too, which is what an instructor arriving with an existing
 * lecture actually wants: the deck they teach from, back as slides they can
 * lecture over, refine and export.
 *
 * ## A link, like the design import
 *
 * Same reasoning as `TemplateImport`: the presentation is already open in
 * another tab and its address is in the clipboard, so a Drive browser would be
 * a second thing to learn for the same result.
 *
 * ## The report is not a nicety
 *
 * One read produces two things — a lecture and the style template its design
 * became — and the author is told about both, because they may want to keep
 * only the template. Content that could not be placed is named by slide, since
 * "slide 4: image" is actionable and "3 boxes dropped" is not.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Deck, ImportReport, Template } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { presentationIdFrom } from './template/TemplateImport'

export default function LectureImportFromSlides({
  projectId,
  onImported,
  onClose,
}: {
  projectId: string
  /** The new lecture, so the caller can list it and open it. */
  onImported: (result: { deck: Deck; template: Template }) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [needsGoogle, setNeedsGoogle] = useState(false)
  // The same choice the design import offers, because it decides the same
  // thing: whether the deck's near-identical slides become one layout.
  const [keepEverySlide, setKeepEverySlide] = useState(false)

  const presentationId = presentationIdFrom(link)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!presentationId || busy) return
    setBusy(true)
    setError(null)
    setReport(null)
    dispatchAction<{ deck: Deck; template: Template; report: ImportReport }>(
      'deck.importFromSlides',
      {
        projectId,
        presentationId,
        ...(keepEverySlide ? { keepEverySlide: true } : {}),
      },
    )
      .then(result => {
        setReport(result.report)
        setLink('')
        onImported(result)
      })
      .catch((e: Error) => {
        // Not connected is a missing step rather than a failure, so the step
        // is offered instead of an error nobody can act on.
        if (/connect|forbidden|403/i.test(e.message)) setNeedsGoogle(true)
        else setError(t('lecture.importSlides.errors.failed'))
      })
      .finally(() => setBusy(false))
  }

  /** Sends the instructor through Google's consent screen and back here. */
  const connect = () => {
    setBusy(true)
    setError(null)
    dispatchAction<{ status: string; url?: string }>('quiz.connectGoogle', {
      returnTo: window.location.href,
    })
      .then(res => {
        if (res.status === 'redirect' && res.url) window.location.href = res.url
        else {
          setNeedsGoogle(false)
          setBusy(false)
        }
      })
      .catch(() => {
        setError(t('lecture.importSlides.errors.failed'))
        setBusy(false)
      })
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        {t('lecture.importSlides.title')}
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        {t('lecture.importSlides.description')}
      </p>

      <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="lecture-import-link">
          {t('lecture.importSlides.linkLabel')}
        </label>
        <input
          id="lecture-import-link"
          type="text"
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder={t('lecture.importSlides.linkPlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!presentationId || busy}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy
            ? t('lecture.importSlides.working')
            : t('lecture.importSlides.submit')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {t('common.cancel')}
        </button>
      </form>

      <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={keepEverySlide}
          onChange={e => setKeepEverySlide(e.target.checked)}
          className="mt-0.5"
        />
        <span>{t('template.import.keepEverySlide')}</span>
      </label>

      {/* Said only once something has been typed, so an empty field is not an
          error the instructor has not made yet. */}
      {link.trim() && !presentationId && (
        <p className="mt-2 text-sm text-slate-500">
          {t('template.import.errors.link')}
        </p>
      )}

      {needsGoogle && (
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          {t('template.import.connect')}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {report && (
        <div
          data-testid="lecture-import-report"
          className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700"
        >
          <p>
            {t('lecture.importSlides.report.summary', {
              slides: report.slidesRead,
              layouts: report.layoutsCreated,
            })}
          </p>
          {/* Named by slide, because that is what an author can act on. */}
          {report.contentDropped?.length ? (
            <p className="mt-1 text-slate-600">
              {t('lecture.importSlides.report.dropped', {
                details: report.contentDropped
                  .map(d => `${d.slide}: ${d.slots.join(', ')}`)
                  .join('; '),
              })}
            </p>
          ) : null}
          <p className="mt-1 text-slate-600">
            {t('lecture.importSlides.report.untouched')}
          </p>
        </div>
      )}
    </section>
  )
}
