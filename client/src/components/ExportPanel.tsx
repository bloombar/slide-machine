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
import {
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  Presentation,
  X,
} from 'lucide-react'
import type {
  DeckExportFormat,
  DriveFolder,
  ExportDownload,
  ExportStatus,
  ExportToDriveResult,
  QuizConnectResult,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import Portal from './Portal'

interface Props {
  deckId: string
}

type Destination = 'download' | 'drive'

const FORMATS: Array<{
  id: DeckExportFormat
  label: string
  hint: string
  icon: typeof FileText
  driveOnly?: boolean
}> = [
  {
    id: 'pdf',
    label: 'PDF',
    hint: 'One page per slide, with image credits.',
    icon: FileText,
  },
  {
    id: 'google-slides',
    label: 'Google Slides',
    hint: 'An editable presentation in your Drive.',
    icon: Presentation,
    driveOnly: true,
  },
  {
    id: 'yaml',
    label: 'YAML',
    hint: 'A human-readable, re-importable file.',
    icon: FileText,
  },
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
  URL.revokeObjectURL(url)
}

/**
 * Finder-style Google Drive folder browser: navigate into folders via the
 * breadcrumb, create new ones, and export into whichever folder you're in.
 * Reuses the quiz feature's Drive actions (a Google connection is all they
 * need).
 */
function FolderPicker({
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
          setError(
            'Could not load your Drive folders. Your Google account may not have granted Drive access.',
          )
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
      .catch(() => setError('Could not create the folder'))
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
          aria-label="Choose a Drive folder"
          className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-lg bg-white p-6 shadow-xl"
        >
          <header className="mb-3 flex items-start justify-between">
            <h2 className="text-lg font-bold">Save {formatLabel} to…</h2>
            <button
              aria-label="Close"
              onClick={onCancel}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto pr-1">
            <nav
              aria-label="Folder path"
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
                    Reconnect Google
                  </button>
                </div>
              ) : loading ? (
                <p className="p-3 text-sm text-slate-500">Loading…</p>
              ) : folders.length === 0 ? (
                <p className="p-3 text-sm text-slate-400">
                  No sub-folders here. Save into this folder, or make a new one
                  below.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {folders.map(f => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => openFolder(f)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
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
                    aria-label="New folder name"
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createFolder()}
                    placeholder={`New folder in ${current.name}`}
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={!newFolderName.trim() || creating}
                    onClick={createFolder}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel new folder"
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
                  New folder
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <span className="min-w-0 truncate text-xs text-slate-500">
              Saving to:{' '}
              <span className="font-medium text-slate-700">{current.name}</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onChoose(current)}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save here'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export default function ExportPanel({ deckId }: Props) {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [format, setFormat] = useState<DeckExportFormat>('pdf')
  const [destination, setDestination] = useState<Destination>('download')
  const [picking, setPicking] = useState(false)
  const [saved, setSaved] = useState<ExportToDriveResult | null>(null)
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
      .then(s => setConnected(s.googleConnected))
      .catch(() => setError('Could not load the export status'))
      .finally(() => setLoading(false))
  }, [deckId])

  // Google Slides is Drive-only; force the destination when it is chosen.
  const chosen = FORMATS.find(f => f.id === format)!
  const effectiveDestination: Destination = chosen.driveOnly
    ? 'drive'
    : destination
  const formatLabel = chosen.label

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
        setError('Could not connect your Google account')
        setBusy(false)
      })
  }

  const download = () => {
    setBusy(true)
    setError(null)
    dispatchAction<ExportDownload>('export.download', {
      deckId,
      format: format as 'pdf' | 'yaml',
    })
      .then(saveToDisk)
      .catch(() => setError('Could not export the deck — please try again'))
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
    })
      .then(res => {
        setSaved(res)
        setPicking(false)
      })
      .catch(() => setError('Could not save to Drive — please try again'))
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
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Export this lecture
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Save the deck as a PDF, an editable Google Slides presentation, or a
          re-importable YAML file.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {driveDenied && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Your Google account connected, but Drive access wasn’t allowed. When
          you reconnect, be sure to tick the Drive permission so exports can be
          saved.
        </p>
      )}

      {/* Format */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">
          Format
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
                <span className="block text-xs text-slate-500">{f.hint}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {/* Destination — hidden for Google Slides (always Drive) */}
      {chosen.driveOnly ? (
        <p className="text-sm text-slate-600">
          Google Slides is always saved to your Google Drive.
        </p>
      ) : (
        <fieldset className="flex gap-4">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            Destination
          </legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="export-destination"
              checked={destination === 'download'}
              onChange={() => setDestination('download')}
            />
            Download
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="export-destination"
              checked={destination === 'drive'}
              onChange={() => setDestination('drive')}
            />
            Save to Google Drive
          </label>
        </fieldset>
      )}

      {saved && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
            <Check className="h-4 w-4" aria-hidden />
            Saved{saved.driveFolderName ? ` to ${saved.driveFolderName}` : ''}
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
            ? 'Working…'
            : effectiveDestination === 'download'
              ? `Download ${formatLabel}`
              : !connected
                ? 'Connect Google'
                : `Save ${formatLabel} to Drive`}
        </button>
        {effectiveDestination === 'drive' && !connected && (
          <p className="mt-2 text-xs text-slate-500">
            Connect a Google account so the file can be saved to your Drive.
          </p>
        )}
      </div>

      {picking && (
        <FolderPicker
          formatLabel={formatLabel}
          saving={busy}
          onCancel={() => setPicking(false)}
          onChoose={saveToDrive}
          onReconnect={connectGoogle}
        />
      )}
    </div>
  )
}
