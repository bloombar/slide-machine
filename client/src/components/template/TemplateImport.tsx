/**
 * Importing a design from a Google Slides presentation (TMPL-8).
 *
 * Most instructors arrive with a deck they already use rather than a design
 * brief, so this — not the template editor — is the realistic way to get a
 * template that looks like their own material.
 *
 * ## Paste a link, not a file picker
 *
 * The instructor already has the presentation open, and its address is in
 * their clipboard. A Drive browser would be a second thing to learn for the
 * same result, so this takes the link and pulls the id out of it — or the bare
 * id, if that is what they have.
 *
 * ## The report is the point of the screen after
 *
 * Consolidation is a judgment call and assets can fail, so what happened is
 * said plainly rather than logged: how many slides became how many layouts,
 * what was merged, what was approximated. An import that quietly produced six
 * layouts from thirty-eight slides would leave the author wondering what it
 * threw away.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'

/** What the server says an import did. */
export interface ImportReport {
  slidesRead: number
  layoutsCreated: number
  largestMerge?: { type: string; slides: number }
  approximated: number
  assetsFailed: number
}

/**
 * The presentation id inside whatever the instructor pasted.
 *
 * A Slides URL is `/presentation/d/<id>/edit`; anything else that looks like
 * an id is taken as one, since a bare id is what an instructor who knows the
 * system will paste.
 */
export const presentationIdFrom = (input: string): string | null => {
  const text = input.trim()
  if (!text) return null
  const fromUrl = /\/presentation\/d\/([a-zA-Z0-9_-]+)/.exec(text)
  if (fromUrl) return fromUrl[1]!
  // A Drive link of any other shape, so the id is a query parameter.
  const fromQuery = /[?&]id=([a-zA-Z0-9_-]+)/.exec(text)
  if (fromQuery) return fromQuery[1]!
  // Not a URL at all: accept it only if it could be an id, so a stray
  // sentence produces a clear complaint rather than a confusing 404.
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : null
}

export default function TemplateImport({
  onImported,
}: {
  /** The new template, so the caller can select it and reload the library. */
  onImported: (template: Template) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [needsGoogle, setNeedsGoogle] = useState(false)
  // Off by default: consolidating the deck into the few designs it is built
  // from is what makes a template usable. On for the deck where that
  // judgement is wrong (TMPL-8).
  const [keepEverySlide, setKeepEverySlide] = useState(false)

  const presentationId = presentationIdFrom(link)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!presentationId || busy) return
    setBusy(true)
    setError(null)
    setReport(null)
    dispatchAction<{ template: Template; report: ImportReport }>(
      'template.importFromSlides',
      { presentationId, ...(keepEverySlide ? { keepEverySlide: true } : {}) },
    )
      .then(result => {
        setReport(result.report)
        setLink('')
        onImported(result.template)
      })
      .catch((e: Error) => {
        // Not connected is not a failure, it is a missing step — so offer the
        // step rather than an error the instructor cannot act on.
        if (/connect|forbidden|403/i.test(e.message)) setNeedsGoogle(true)
        else
          setError(
            /google/i.test(e.message)
              ? t('template.import.errors.google')
              : t('template.import.errors.failed'),
          )
      })
      .finally(() => setBusy(false))
  }

  /** Sends the instructor through Google's consent screen and back to this
   * tab. A full page load, so where to return is carried in the URL. */
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
        setError(t('template.import.errors.failed'))
        setBusy(false)
      })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {t('template.import.open')}
      </button>
    )
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        {t('template.import.title')}
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        {t('template.import.description')}
      </p>

      <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="template-import-link">
          {t('template.import.linkLabel')}
        </label>
        <input
          id="template-import-link"
          type="text"
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder={t('template.import.linkPlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!presentationId || busy}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? t('template.import.working') : t('template.import.submit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
            setReport(null)
          }}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {t('common.cancel')}
        </button>
      </form>

      {/* The judgement an import makes, offered rather than assumed: most
          decks rebuild one design by hand and want it back as one layout,
          and some are a handful of genuinely different pages. */}
      <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={keepEverySlide}
          onChange={e => setKeepEverySlide(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          {t('template.import.keepEverySlide')}
          <span className="block text-xs text-slate-500">
            {t('template.import.keepEverySlideHint')}
          </span>
        </span>
      </label>

      {/* Said only once something has been typed, so an empty field is not an
          error the instructor has not made yet. */}
      {link.trim() && !presentationId && (
        <p className="mt-2 text-sm text-amber-700">
          {t('template.import.errors.link')}
        </p>
      )}

      {needsGoogle && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-700">
            {t('template.import.connectPrompt')}
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t('template.import.connect')}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {report && (
        <div
          role="status"
          data-testid="import-report"
          className="mt-3 space-y-1 text-sm text-slate-700"
        >
          <p className="font-medium text-slate-900">
            {t('template.import.report.summary', {
              slides: report.slidesRead,
              layouts: report.layoutsCreated,
            })}
          </p>
          {report.largestMerge && report.largestMerge.slides > 1 && (
            <p>
              {t('template.import.report.merged', {
                count: report.largestMerge.slides,
              })}
            </p>
          )}
          {report.approximated > 0 && (
            <p>
              {t('template.import.report.approximated', {
                count: report.approximated,
              })}
            </p>
          )}
          {report.assetsFailed > 0 && (
            <p className="text-amber-700">
              {t('template.import.report.assetsFailed', {
                count: report.assetsFailed,
              })}
            </p>
          )}
          <p className="text-slate-500">{t('template.import.report.review')}</p>
        </div>
      )}
    </section>
  )
}
