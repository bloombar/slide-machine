/**
 * Importing a design from a Google Slides presentation (TMPL-8).
 *
 * Most instructors arrive with a deck they already use rather than a design
 * brief, so this — not the template editor — is the realistic way to get a
 * template that looks like their own material.
 *
 * ## Google's Picker, not a browser of our own
 *
 * The app holds only `drive.file`, which cannot list a Drive, so the
 * presentation is chosen in Google's own Picker — and choosing it there is
 * what grants this app access to it.
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
import ConsolidateToggle, { useConsolidateChoice } from './ConsolidateToggle'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { ApiError } from '../../api/http'
import { apiErrorMessage } from '../../i18n/apiError'
import DrivePicker from '../DrivePicker'
import type { PickedDriveItem } from '../../lib/google-picker'

/** What the server says an import did. */
export interface ImportReport {
  slidesRead: number
  layoutsCreated: number
  largestMerge?: { type: string; slides: number }
  approximated: number
  /** Pages the author had marked "skip slide", which the import left out.
   * Absent when the deck had none. */
  slidesSkipped?: number
  /** Rules the import declined to redraw, because a diagonal has no rectangle
   * that stands for it. Absent when there were none. */
  rulesDeclined?: number
  /** Absent when the import attempted no fetch at all — not the same as none
   * having failed, which is why it is not a plain number. */
  assetsFailed?: number
}

/** What the picked file is for: a presentation is a design to derive from
 * (TMPL-8), anything else is a design file this app wrote earlier (EXP-3). */
export const importSourceFor = (item: PickedDriveItem): ImportSource =>
  item.mimeType === PRESENTATION_MIME
    ? { action: 'template.importFromSlides', id: item.id }
    : { action: 'template.importFromDrive', id: item.id }

/** Google's own type for a native Slides presentation. */
export const PRESENTATION_MIME = 'application/vnd.google-apps.presentation'

/** Which import a picked file is for. */
export interface ImportSource {
  /** The action that reads it. */
  action: 'template.importFromSlides' | 'template.importFromDrive'
  id: string
}

export default function TemplateImport({
  onImported,
  otherSources,
}: {
  /** The new template, so the caller can select it and reload the library. */
  onImported: (template: Template) => void
  /**
   * The other ways a design arrives — a template file, or one kept in Drive
   * (EXP-3) — shown inside this panel rather than beside it.
   *
   * They were three controls stacked on the Design tab, all reading as
   * separate features and two of them wearing the same icon as Export. They
   * are one question ("where is the design coming from?"), so they are one
   * panel, and the tab has one button for it.
   */
  otherSources?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  /** The file chosen in Google's picker, waiting to be imported. */
  const [picked, setPicked] = useState<PickedDriveItem | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [needsGoogle, setNeedsGoogle] = useState(false)
  /*
   * Whether to combine near-identical slides into one layout (TMPL-8).
   *
   * Off by default, so an import keeps every slide exactly as it was drawn.
   * Consolidation is a judgement — which slides are "the same design" — and
   * a judgement made silently is one the author cannot see being made: a
   * deck came back with fewer layouts than it had slides and nothing said
   * which had been merged into which.
   *
   * Kept as an offer instead. `keepEverySlide` is still what the server
   * takes, so this sends its opposite.
   */
  const { tidy, setTidy, keepEverySlide } = useConsolidateChoice()

  const source = picked ? importSourceFor(picked) : null
  const fromSlides = source?.action === 'template.importFromSlides'

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!source || busy) return
    setBusy(true)
    setError(null)
    setReport(null)
    // A design file names no slides, so consolidating is not a question it
    // can be asked — the choice travels only with a presentation.
    const input = fromSlides
      ? {
          presentationId: source.id,
          keepEverySlide,
        }
      : { fileId: source.id }
    dispatchAction<Template | { template: Template; report: ImportReport }>(
      source.action,
      input,
    )
      .then(result => {
        // The design import reports what it made of the deck; a file simply
        // comes back as the template it already was.
        if ('template' in result) {
          setReport(result.report)
          onImported(result.template)
        } else {
          onImported(result)
        }
        setPicked(null)
      })
      .catch((e: Error) => {
        // Not connected is not a failure, it is a missing step — so offer the
        // step rather than an error the instructor cannot act on. The server
        // says which case this is by code; matching on the message was
        // guesswork that missed every error it had not seen before.
        const code = e instanceof ApiError ? e.code : ''
        if (
          code === 'google_reconnect' ||
          code === 'capability_required' ||
          (!code && /connect|forbidden|403/i.test(e.message))
        ) {
          setNeedsGoogle(true)
          return
        }
        // Which kind of refusal it was, said in the reader's language:
        // server messages are authored in English and stay that way, so the
        // code is translated rather than the message repeated (docs/I18N.md).
        setError(apiErrorMessage(e, t, 'template.import.errors.failed'))
      })
      .finally(() => setBusy(false))
  }

  /** Sends the instructor through Google's consent screen and back to this
   * tab. A full page load, so where to return is carried in the URL. *
   * `onConnected` runs when the connect completed without leaving the page —
   * mock mode, or an account that was already connected — so the picker that
   * sent us here can open again rather than making the instructor find it.
   */
  const connect = (onConnected?: () => void) => {
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
          onConnected?.()
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

      <form
        onSubmit={submit}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        {/* Google's picker does the browsing: the app holds only `drive.file`
            and cannot list a Drive, and choosing the file is what lets it
            read that one file. */}
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex min-w-0 items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {picked ? picked.name : t('template.import.choose')}
          </span>
        </button>
        <button
          type="submit"
          disabled={!source || busy}
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
            setPicked(null)
          }}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {t('common.cancel')}
        </button>
      </form>

      {/* The judgement an import can make, offered rather than taken. A
          hand-built deck usually rebuilds one design many times over, and
          recognising those as one layout is what makes the result usable
          (TMPL-8) — but which slides count as "the same design" is a guess,
          and a guess made silently leaves an author with fewer layouts than
          slides and no way to see why. */}
      {/* Hidden for a design file, which has no slides to consolidate: a
          control that cannot do anything is worse than one that is absent. */}
      {(!picked || fromSlides) && (
        <ConsolidateToggle tidy={tidy} onChange={setTidy} />
      )}

      {picking && (
        <DrivePicker
          kind="importable"
          title={t('template.import.choose')}
          onPick={item => {
            setPicked(item)
            setPicking(false)
            setError(null)
          }}
          onCancel={() => setPicking(false)}
          // The picker cannot list a Drive this account has not granted, so
          // the reconnect closes it and opens it again once the grant is in
          // place — rather than leaving an error where the files should be.
          onReconnect={() => {
            setPicking(false)
            connect(() => setPicking(true))
          }}
        />
      )}

      {needsGoogle && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-700">
            {t('template.import.connectPrompt')}
          </p>
          <button
            type="button"
            onClick={() => connect()}
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
          {(report.slidesSkipped ?? 0) > 0 && (
            <p>
              {t('template.import.report.skipped', {
                count: report.slidesSkipped,
              })}
            </p>
          )}
          {(report.rulesDeclined ?? 0) > 0 && (
            <p>
              {t('template.import.report.rulesDeclined', {
                count: report.rulesDeclined,
              })}
            </p>
          )}
          {(report.assetsFailed ?? 0) > 0 && (
            <p className="text-amber-700">
              {t('template.import.report.assetsFailed', {
                count: report.assetsFailed,
              })}
            </p>
          )}
          <p className="text-slate-500">{t('template.import.report.review')}</p>
        </div>
      )}

      {/* The other ways in, under a rule: same question, lesser-used answers.
          A design already exported as a file, or one kept in Drive (EXP-3). */}
      {otherSources && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h4 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('template.import.otherSources')}
          </h4>
          {otherSources}
        </div>
      )}
    </section>
  )
}
