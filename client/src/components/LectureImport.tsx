/**
 * Bringing in a lecture that already exists (EXP-3/EXP-5).
 *
 * Two sources, one panel. A Google Slides presentation the instructor teaches
 * from becomes a lecture drawn in its own design (EXP-5); a `.yaml` file this
 * app exported earlier becomes the lecture it was (EXP-3). They were two menu
 * entries that read as two features, and the instructor had to know which of
 * them their material counted as before they could start.
 *
 * ## A link, like the design import
 *
 * Same reasoning as `TemplateImport`: the presentation is already open in
 * another tab and its address is in the clipboard, so a Drive browser would be
 * a second thing to learn for the same result.
 *
 * ## What happened is said outside this panel
 *
 * A finished import closes the panel — leaving it open over the list it just
 * added to is a box the user has to dismiss to see their own work. So the
 * report is handed to the caller, which says it beside the lecture that
 * arrived rather than inside a panel that is gone.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import type {
  Deck,
  DeckImportResult,
  ImportReport,
  Template,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
import { apiErrorMessage } from '../i18n/apiError'
import { presentationIdFrom } from './template/TemplateImport'

export default function LectureImport({
  projectId,
  onImported,
  onClose,
}: {
  projectId: string
  /** The new lecture, so the caller can list it and open it. A design
   * accompanies it only when one was derived (EXP-5); a file import restores
   * the lecture alone. */
  onImported: (result: {
    deck: Deck
    template?: Template
    /** Non-fatal notes from a file import, e.g. a substituted template. */
    warnings?: string[]
    /** What a presentation import made of the deck, so the caller can say it
     * once the panel has closed. */
    report?: ImportReport
  }) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsGoogle, setNeedsGoogle] = useState(false)
  // The same choice the design import offers, because it decides the same
  // thing: whether the deck's near-identical slides become one layout.
  const [keepEverySlide, setKeepEverySlide] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const presentationId = presentationIdFrom(link)

  /** A lecture this app exported earlier, restored as the lecture it was
   * (EXP-3). No design is derived: the file names the template it wants. */
  const importFile = async (file: File) => {
    setError(null)
    let content: string
    try {
      content = await file.text()
    } catch {
      setError(t('lecture.import.errors.read'))
      return
    }
    setBusy(true)
    try {
      const result = await dispatchAction<DeckImportResult>('deck.import', {
        projectId,
        content,
      })
      onImported({ deck: result.deck, warnings: result.warnings })
    } catch (err) {
      setError(
        err instanceof ApiError && err.details?.length
          ? t('lecture.import.errors.invalid', {
              details: err.details.join(' '),
            })
          : apiErrorMessage(err, t, 'lecture.import.errors.failed'),
      )
    } finally {
      setBusy(false)
      // Cleared so the same file can be picked again after a fix.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!presentationId || busy) return
    setBusy(true)
    setError(null)
    dispatchAction<{ deck: Deck; template: Template; report: ImportReport }>(
      'deck.importFromSlides',
      {
        projectId,
        presentationId,
        ...(keepEverySlide ? { keepEverySlide: true } : {}),
      },
    )
      .then(result => {
        setLink('')
        // Handed over rather than shown here: the panel closes on success, so
        // what happened has to survive it.
        onImported(result)
      })
      .catch((e: Error) => {
        // Not connected is a missing step rather than a failure, so the step
        // is offered instead of an error nobody can act on. The server says
        // which case this is by code rather than leaving it to be guessed
        // from the message.
        const code = e instanceof ApiError ? e.code : ''
        if (
          code === 'google_reconnect' ||
          code === 'capability_required' ||
          (!code && /connect|forbidden|403/i.test(e.message))
        ) {
          setNeedsGoogle(true)
          return
        }
        // Translated by code rather than repeating the server's English
        // (docs/I18N.md), so "not found" and "refused" stay distinguishable.
        setError(apiErrorMessage(e, t, 'lecture.importSlides.errors.failed'))
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

      {/* The other source, under a rule: a lecture this app exported earlier
          (EXP-3). Same arrival, different material. */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <h4 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {t('lecture.importSlides.otherSources')}
        </h4>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {busy
            ? t('lecture.importSlides.working')
            : t('lecture.importSlides.fileOpen')}
          <input
            ref={fileInput}
            type="file"
            accept=".yaml,.yml,application/x-yaml,text/yaml"
            className="sr-only"
            disabled={busy}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void importFile(file)
            }}
          />
        </label>
      </div>
    </section>
  )
}
