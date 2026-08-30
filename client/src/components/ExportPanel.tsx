/**
 * Export tab of the lecture settings (SPEC EXP-1/EXP-2/EXP-4). Lets the user
 * export the deck as a PDF, a native Google Slides presentation, or a YAML
 * file:
 *   - PDF and YAML can be downloaded directly, or saved to Google Drive.
 *   - Google Slides is always created in the connected Google Drive.
 * Saving to Drive (and Google Slides) first connects a Google account if
 * needed, then opens Google's own picker to choose the destination folder
 * (DrivePicker).
 * The server runs the Google side mock- or live-backed per config; this UI is
 * identical either way.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  Presentation,
  Trash2,
} from 'lucide-react'
import type {
  DeckExportFormat,
  DriveFolder,
  ExportDownload,
  ExportNote,
  ExportedFile,
  ExportStatus,
  ExportToDriveResult,
  Locale,
  QuizConnectResult,
} from '@slide-machine/shared'
import {
  WHITEBOARD_EXPORT_FORMATS,
  LAYOUT_EXPORT_FORMATS,
  localeShortLabel,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
// The singleton's standalone translator, for the load effects below: it
// is module-level and stable, so it is not an effect dependency the way
// the hook's `t` is (which changes identity on every language switch,
// and would re-run the fetch).
import { t as translate } from '../i18n'
import ConfirmDialog from './ConfirmDialog'
import DrivePicker from './DrivePicker'

interface Props {
  deckId: string
  /** The language the viewer is currently reading the slides in (SHARE-2).
   * Set, the export carries that translation instead of the authored text —
   * what you are looking at is what you get. */
  locale?: Locale
}

type Destination = 'download' | 'drive'

/** The export formats, in order. "PDF", "YAML" and "Google Slides" are
 * format and product names, so only each one's hint is translated —
 * keyed `export.formats.<id>.hint`. */
const FORMATS: Array<{
  id: DeckExportFormat
  label: string
  icon: typeof FileText
  driveOnly?: boolean
}> = [
  { id: 'pdf', label: 'PDF', icon: FileText },
  {
    id: 'google-slides',
    label: 'Google Slides',
    icon: Presentation,
    driveOnly: true,
  },
  // The format everyone else can open. Sits beside Google Slides because the
  // two answer the same question — "give me something I can edit" — and
  // differ only in where it opens.
  { id: 'pptx', label: 'PowerPoint', icon: Presentation },
  { id: 'yaml', label: 'YAML', icon: FileText },
]

/** Decodes base64 file contents into a Blob of the given type. */
const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

/** Triggers a browser download of the file. */
const saveToDisk = (file: ExportDownload): void => {
  const url = URL.createObjectURL(
    base64ToBlob(file.contentBase64, file.mimeType),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Defer the revoke: some browsers read the blob asynchronously after the
  // click, and revoking on the same tick can produce an empty download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function ExportPanel({ deckId, locale }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [format, setFormat] = useState<DeckExportFormat>('pdf')
  const [destination, setDestination] = useState<Destination>('download')
  const [picking, setPicking] = useState(false)
  const [saved, setSaved] = useState<ExportToDriveResult | null>(null)
  // What the file could not carry (EXP-7). Shown rather than logged: the
  // alternative is an author finding a hole in a slide months later.
  const [notes, setNotes] = useState<ExportNote[]>([])
  // Whether the deck has any freehand whiteboard marks, and whether to include
  // them in the export (default on; only offered for the visual formats).
  const [hasWhiteboard, setHasWhiteboard] = useState(false)
  // Whether this deployment offers the layouts-carrying shape at all
  // (EXPORT_REUSABLE_LAYOUTS). Absent until status answers, so the option
  // does not flash in and out on a deployment that does not have it.
  const [layoutsOffered, setLayoutsOffered] = useState(false)
  const [includeWhiteboard, setIncludeWhiteboard] = useState(true)
  // Whether to carry the lecture's design as reusable layout pages (EXP-1).
  // Off by default: a flat file is what most people want to hand someone, and
  // the layouts only matter if the file is going to be edited or brought back.
  const [withLayouts, setWithLayouts] = useState(false)
  // Exports already saved to Drive, so they can be reopened or deleted.
  const [exports, setExports] = useState<ExportedFile[]>([])
  // Set when a just-deleted export lived in another collaborator's Drive, so a
  // modal can explain it's gone from the lecture but still in their Drive.
  const [remainsInOtherDrive, setRemainsInOtherDrive] = useState(false)
  // Set when the user returned from a connect that did not grant Drive access
  // (Google's granular consent — the Drive permission was unticked). A one-shot
  // signal: the flag is stripped from the URL so a refresh (or a later
  // successful reconnect) doesn't keep showing the banner.
  const [driveDenied, setDriveDenied] = useState(
    () =>
      new URLSearchParams(window.location.search).get('connect') ===
      'drive_denied',
  )
  useEffect(() => {
    if (!driveDenied) return
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('connect')
      window.history.replaceState(window.history.state, '', url)
    } catch {
      // replaceState can throw in sandboxed/odd-origin contexts; the banner
      // still works, it just won't be stripped from the address bar.
    }
    // Run once on mount; driveDenied is only ever set from the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    dispatchAction<ExportStatus>('export.status', { deckId })
      .then(s => {
        setConnected(s.googleConnected)
        setHasWhiteboard(s.hasWhiteboard)
        setLayoutsOffered(s.layoutsOffered)
        setExports(s.exports)
      })
      .catch(() => setError(translate('export.errors.status')))
      .finally(() => setLoading(false))
  }, [deckId])

  // Google Slides is Drive-only; force the destination when it is chosen.
  const chosen = FORMATS.find(f => f.id === format)!
  const effectiveDestination: Destination = chosen.driveOnly
    ? 'drive'
    : destination
  const formatLabel = chosen.label

  // The include-whiteboard option is offered only when the deck actually has
  // marks AND the chosen format can render them (PDF, Google Slides — not YAML).
  const showWhiteboardOption =
    hasWhiteboard && WHITEBOARD_EXPORT_FORMATS.includes(format)

  // The layouts option applies to the slide formats that have somewhere to
  // put them — and only where the deployment offers the shape at all, since
  // otherwise the server would ignore the answer.
  const showLayoutsOption =
    layoutsOffered && LAYOUT_EXPORT_FORMATS.includes(format)

  const connectGoogle = () => {
    setBusy(true)
    setError(null)
    // Return to THIS lecture with the Export tab reopened (OAuth is a full page
    // load, so signal the tab via a URL param — router state is lost).
    const returnTo = new URL(window.location.href)
    returnTo.searchParams.set('settings', 'export')
    // Don't carry a prior drive-denied flag back, or a SUCCESSFUL reconnect
    // would return to a URL that still shows the banner.
    returnTo.searchParams.delete('connect')
    dispatchAction<QuizConnectResult>('quiz.connectGoogle', {
      returnTo: returnTo.toString(),
    })
      .then(res => {
        if (res.status === 'redirect') {
          window.location.href = res.url
        } else {
          setConnected(true)
          setDriveDenied(false)
          setBusy(false)
        }
      })
      .catch(() => {
        setError(t('quiz.errors.connect'))
        setBusy(false)
      })
  }

  const download = () => {
    setBusy(true)
    setError(null)
    setNotes([])
    dispatchAction<ExportDownload>('export.download', {
      deckId,
      format: format as 'pdf' | 'yaml' | 'pptx',
      includeWhiteboard,
      withLayouts,
      locale,
    })
      .then(file => {
        saveToDisk(file)
        setNotes(file.notes ?? [])
      })
      .catch(() => setError(t('export.errors.download')))
      .finally(() => setBusy(false))
  }

  const saveToDrive = (folder: DriveFolder) => {
    setBusy(true)
    setError(null)
    dispatchAction<ExportToDriveResult>('export.toDrive', {
      deckId,
      format,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
      includeWhiteboard,
      withLayouts,
      locale,
    })
      .then(res => {
        setSaved(res)
        setNotes(res.notes ?? [])
        setExports(prev => [...prev, res])
        setPicking(false)
      })
      .catch(() => setError(t('export.errors.drive')))
      .finally(() => setBusy(false))
  }

  const deleteExport = (fileId: string) => {
    setBusy(true)
    setError(null)
    dispatchAction<{ deleted: boolean; remainsInOtherDrive?: boolean }>(
      'export.delete',
      { deckId, fileId },
    )
      .then(res => {
        setExports(prev => prev.filter(e => e.fileId !== fileId))
        setSaved(prev => (prev?.fileId === fileId ? null : prev))
        // Saved to another collaborator's Drive: it's gone from the lecture but
        // still in their Drive, and our credentials can't remove it there.
        if (res.remainsInOtherDrive) setRemainsInOtherDrive(true)
      })
      .catch(() => setError(t('export.errors.delete')))
      .finally(() => setBusy(false))
  }

  // The main button: download runs immediately; Drive needs a connection then
  // the folder picker.
  const onExport = () => {
    setSaved(null)
    if (effectiveDestination === 'download') {
      download()
    } else if (!connected) {
      connectGoogle()
    } else {
      setPicking(true)
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          {t('export.heading')}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{t('export.intro')}</p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {driveDenied && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t('export.driveDenied')}
        </p>
      )}

      {/* Format */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">
          {t('export.format')}
        </legend>
        {FORMATS.map(f => {
          const Icon = f.icon
          return (
            <label
              key={f.id}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                format === f.id
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="export-format"
                className="mt-1"
                checked={format === f.id}
                onChange={() => setFormat(f.id)}
              />
              <Icon
                className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500"
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">
                  {f.label}
                </span>
                <span className="block text-xs text-slate-500">
                  {t(`export.formats.${f.id}.hint`)}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {/* Destination — hidden for Google Slides (always Drive) */}
      {chosen.driveOnly ? (
        <p className="text-sm text-slate-600">
          {t('export.slidesAlwaysDrive')}
        </p>
      ) : (
        <fieldset className="flex gap-4">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            {t('export.destination')}
          </legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="export-destination"
              checked={destination === 'download'}
              onChange={() => setDestination('download')}
            />
            {t('export.download')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="export-destination"
              checked={destination === 'drive'}
              onChange={() => setDestination('drive')}
            />
            {t('export.toDrive')}
          </label>
        </fieldset>
      )}

      {/* Says which language the file will carry, when it is not the one the
          lecture was written in — an export that silently differed from the
          deck would be a surprise on someone's disk. */}
      {locale && (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {t('export.translated', { language: localeShortLabel(locale) })}
        </p>
      )}

      {/* Whiteboard marks — only when the deck has any AND the format shows them */}
      {showWhiteboardOption && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeWhiteboard}
            onChange={e => setIncludeWhiteboard(e.target.checked)}
          />
          <span>
            {t('export.includeWhiteboard.label')}
            <span className="block text-xs text-slate-500">
              {t('export.includeWhiteboard.hint')}
            </span>
          </span>
        </label>
      )}

      {/* Reusable layouts — only for the formats that can hold them (EXP-1) */}
      {showLayoutsOption && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={withLayouts}
            onChange={e => setWithLayouts(e.target.checked)}
          />
          <span>
            {t('export.withLayouts.label')}
            <span className="block text-xs text-slate-500">
              {t('export.withLayouts.hint')}
            </span>
          </span>
        </label>
      )}

      {notes.length > 0 && (
        /* The export's report: what the format could not carry. Amber rather
           than red — the file is there and usable, and this is the part of it
           that is not what the author wrote (EXP-7). */
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-4"
        >
          <span className="text-sm font-medium text-amber-900">
            {t('export.notes.heading')}
          </span>
          <ul className="list-disc ps-5 text-sm text-amber-900">
            {notes.map((note, i) => (
              <li key={i}>
                {t(`export.notes.${note.reason}`, { detail: note.detail })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saved && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
            <Check className="h-4 w-4" aria-hidden />
            {saved.driveFolderName
              ? t('export.savedToFolder', { folder: saved.driveFolderName })
              : t('export.saved')}
          </span>
          <a
            href={saved.fileUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-w-0 items-center gap-1 truncate text-sm text-indigo-600 hover:underline"
          >
            <span className="truncate">{saved.fileName}</span>
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        </div>
      )}

      <div>
        <button
          type="button"
          disabled={busy}
          onClick={onExport}
          className="inline-flex items-center gap-1.5 self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {effectiveDestination === 'download' ? (
            <Download className="h-4 w-4" aria-hidden />
          ) : (
            <ExternalLink className="h-4 w-4" aria-hidden />
          )}
          {busy
            ? t('export.working')
            : effectiveDestination === 'download'
              ? t('export.downloadFormat', { format: formatLabel })
              : !connected
                ? t('quiz.connect')
                : t('export.saveFormatToDrive', { format: formatLabel })}
        </button>
        {effectiveDestination === 'drive' && !connected && (
          <p className="mt-2 text-xs text-slate-500">
            {t('export.connectHint')}
          </p>
        )}
      </div>

      {exports.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-slate-700">
            {t('export.savedList')}
          </h4>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {exports.map(e => (
              <li key={e.fileId} className="flex items-center gap-2 px-3 py-2">
                <a
                  href={e.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-indigo-600 hover:underline"
                >
                  <span className="truncate">{e.fileName}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </a>
                {/* The format's own name (PDF, YAML, Google Slides) — a
                    file-format name, the same in every language. */}
                <span className="shrink-0 text-xs uppercase text-slate-400">
                  {FORMATS.find(f => f.id === e.format)?.label ?? e.format}
                </span>
                <button
                  type="button"
                  aria-label={t('export.deleteFile', { name: e.fileName })}
                  disabled={busy}
                  onClick={() => deleteExport(e.fileId)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {picking && (
        <DrivePicker
          kind="folder"
          title={t('export.folder.title', { format: formatLabel })}
          confirmLabel={t('export.saveHere')}
          busyLabel={t('export.saving')}
          busy={busy}
          onCancel={() => setPicking(false)}
          onPick={saveToDrive}
          onReconnect={connectGoogle}
        />
      )}

      {remainsInOtherDrive && (
        <ConfirmDialog
          title={t('export.otherDrive.title')}
          message={t('export.otherDrive.message')}
          confirmLabel={t('common.ok')}
          onConfirm={() => setRemainsInOtherDrive(false)}
          onCancel={() => setRemainsInOtherDrive(false)}
        />
      )}
    </div>
  )
}
