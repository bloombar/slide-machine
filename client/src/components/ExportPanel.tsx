/**
 * Export tab of the lecture settings (SPEC EXP-1/EXP-2/EXP-4). Lets the user
 * export the deck as a PDF, a native Google Slides presentation, or a YAML
 * file:
 *   - PDF and YAML can be downloaded directly, or saved to Google Drive.
 *   - Google Slides is always created in the connected Google Drive.
 * Saving to Drive (and Google Slides) first connects a Google account if
 * needed, then opens a finder-style folder picker to choose the destination.
 * The server runs the Google side mock- or live-backed per config; this UI is
 * identical either way.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  Presentation,
  Trash2,
  X,
} from 'lucide-react'
import type {
  DeckExportFormat,
  DriveFolder,
  ExportDownload,
  ExportedFile,
  ExportStatus,
  ExportToDriveResult,
  Locale,
  QuizConnectResult,
} from '@slide-machine/shared'
import {
  WHITEBOARD_EXPORT_FORMATS,
  localeShortLabel,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
// The singleton's standalone translator, for the load effects below: it
// is module-level and stable, so it is not an effect dependency the way
// the hook's `t` is (which changes identity on every language switch,
// and would re-run the fetch).
import { t as translate } from '../i18n'
import Portal from './Portal'
import ConfirmDialog from './ConfirmDialog'

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

/**
 * Finder-style Google Drive folder browser: navigate into folders via the
 * breadcrumb, create new ones, and export into whichever folder you're in.
 * Reuses the quiz feature's Drive actions (a Google connection is all they
 * need).
 */
export function FolderPicker({
  formatLabel,
  saving,
  onCancel,
  onChoose,
  onReconnect,
}: {
  formatLabel: string
  saving: boolean
  onCancel: () => void
  onChoose: (folder: DriveFolder) => void
  onReconnect: () => void
}) {
  const { t } = useTranslation()
  // Rooted at My Drive — a Google product name, so it is not translated.
  const [path, setPath] = useState<DriveFolder[]>([
    { id: 'root', name: 'My Drive' },
  ])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [creating, setCreating] = useState(false)

  const current = path[path.length - 1]!

  useEffect(() => {
    let ignore = false
    dispatchAction<{ folders: DriveFolder[] }>('quiz.driveFolders', {
      parentId: current.id,
    })
      .then(r => {
        if (ignore) return
        setFolders(r.folders)
        setLoadedFor(current.id)
        setError(null)
      })
      .catch(() => {
        if (!ignore) {
          setError(translate('quiz.errors.loadFolders'))
        }
      })
    return () => {
      ignore = true
    }
  }, [current.id])

  const loading = loadedFor !== current.id

  const openFolder = (f: DriveFolder) => {
    setCreatingNew(false)
    setPath(p => [...p, f])
  }
  const goTo = (index: number) => {
    setCreatingNew(false)
    setPath(p => p.slice(0, index + 1))
  }

  const createFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    dispatchAction<DriveFolder>('quiz.createFolder', {
      name,
      parentId: current.id,
    })
      .then(folder => {
        setNewFolderName('')
        setCreatingNew(false)
        openFolder(folder)
      })
      .catch(() => setError(t('quiz.errors.createFolder')))
      .finally(() => setCreating(false))
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div
          aria-hidden
          onClick={onCancel}
          className="absolute inset-0 bg-black/30"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('quiz.folder.dialog')}
          className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-lg bg-white p-6 shadow-xl"
        >
          <header className="mb-3 flex items-start justify-between">
            <h2 className="text-lg font-bold">
              {t('export.folder.title', { format: formatLabel })}
            </h2>
            <button
              aria-label={t('common.close')}
              onClick={onCancel}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto pr-1">
            <nav
              aria-label={t('quiz.folder.path')}
              className="mb-2 flex flex-wrap items-center gap-0.5 text-sm text-slate-600"
            >
              {path.map((f, i) => (
                <span key={f.id} className="flex items-center gap-0.5">
                  {i > 0 && (
                    <ChevronRight
                      className="h-3.5 w-3.5 text-slate-400"
                      aria-hidden
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    disabled={i === path.length - 1}
                    className="rounded px-1 hover:text-slate-900 disabled:font-semibold disabled:text-slate-900"
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="max-h-44 min-h-[6rem] overflow-y-auto rounded-md border border-slate-200">
              {error ? (
                <div className="p-3">
                  <p className="text-sm text-rose-600">{error}</p>
                  <button
                    type="button"
                    onClick={onReconnect}
                    className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    {t('quiz.reconnect')}
                  </button>
                </div>
              ) : loading ? (
                <p className="p-3 text-sm text-slate-500">
                  {t('common.loading')}
                </p>
              ) : folders.length === 0 ? (
                <p className="p-3 text-sm text-slate-400">
                  {t('export.folder.empty')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {folders.map(f => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => openFolder(f)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50"
                      >
                        <Folder
                          className="h-4 w-4 shrink-0 text-indigo-500"
                          aria-hidden
                        />
                        <span className="flex-1 truncate">{f.name}</span>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-slate-300"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-2">
              {creatingNew ? (
                <div className="flex items-center gap-2">
                  <input
                    aria-label={t('quiz.folder.newName')}
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createFolder()}
                    placeholder={t('quiz.folder.newIn', {
                      folder: current.name,
                    })}
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={!newFolderName.trim() || creating}
                    onClick={createFolder}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {creating ? t('quiz.folder.creating') : t('common.create')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('quiz.folder.cancelNew')}
                    onClick={() => {
                      setCreatingNew(false)
                      setNewFolderName('')
                    }}
                    className="rounded p-1 text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingNew(true)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
                >
                  <FolderPlus className="h-4 w-4" aria-hidden />
                  {t('quiz.folder.new')}
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <span className="min-w-0 truncate text-xs text-slate-500">
              {t('quiz.savingTo')}{' '}
              <span className="font-medium text-slate-700">{current.name}</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onChoose(current)}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? t('export.saving') : t('export.saveHere')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
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
  // Whether the deck has any freehand whiteboard marks, and whether to include
  // them in the export (default on; only offered for the visual formats).
  const [hasWhiteboard, setHasWhiteboard] = useState(false)
  const [includeWhiteboard, setIncludeWhiteboard] = useState(true)
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
    dispatchAction<ExportDownload>('export.download', {
      deckId,
      format: format as 'pdf' | 'yaml',
      includeWhiteboard,
      locale,
    })
      .then(saveToDisk)
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
      locale,
    })
      .then(res => {
        setSaved(res)
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
        <FolderPicker
          formatLabel={formatLabel}
          saving={busy}
          onCancel={() => setPicking(false)}
          onChoose={saveToDrive}
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
