/**
 * Choosing a file or folder in the instructor's Google Drive (EXP-3/EXP-4/
 * QUIZ-2) — one component for every place that asks.
 *
 * Live, this is Google's own Picker. The app holds a single Drive scope,
 * `drive.file`, which reaches what the app created and what the user hands it
 * and cannot list a Drive at all — so the browsing has to happen on Google's
 * side, and the act of picking is what grants access to the one file chosen.
 *
 * With no Google configured (a dev machine, the test suite) it falls back to
 * the finder-style dialog below over a fabricated tree, so the whole flow —
 * choose, confirm, save or import — can be exercised without credentials. That
 * is the same bargain every other Google surface in this app makes.
 *
 * A live deployment with no Picker key gets neither: it says so, rather than
 * opening a chooser that could only come back empty.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, Folder, Presentation, X } from 'lucide-react'
import type { DriveFolder, DriveImportable } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { getDrivePicker } from '../runtime-config'
import {
  FOLDER_MIME,
  openGooglePicker,
  type DrivePickerKind,
  type PickedDriveItem,
} from '../lib/google-picker'
import Portal from './Portal'

interface Props {
  /** Somewhere to save, or something to read. */
  kind: DrivePickerKind
  /** Heading for the fallback dialog. Google's Picker draws its own. */
  title: string
  /** Label on the fallback dialog's confirm button (folder kind only) — the
   * caller's own wording, since "Save here" and "Publish here" are different
   * promises. */
  confirmLabel?: string
  /** Label while the caller is busy with what was chosen. */
  busyLabel?: string
  /** Whether the caller is mid-save, so the confirm button waits. */
  busy?: boolean
  onPick: (item: PickedDriveItem) => void
  onCancel: () => void
  /** Offered when Google refuses: a stale grant is a step the user can take. */
  onReconnect: () => void
}

/** A folder as the picker's result shape. */
const asItem = (folder: DriveFolder): PickedDriveItem => ({
  ...folder,
  mimeType: FOLDER_MIME,
})

/**
 * Google's Picker: fetch a browser access token for the connected account,
 * then hand off. Nothing of ours is drawn — the widget is Google's, in
 * Google's iframe — so this renders only what goes wrong.
 */
function GooglePickerHost({
  kind,
  onPick,
  onCancel,
  onReconnect,
}: Pick<Props, 'kind' | 'onPick' | 'onCancel' | 'onReconnect'>) {
  // The language straight off i18next rather than through `useLocale`: all
  // that is wanted is a tag to hand Google, and the hook additionally needs
  // the auth context, which a picker has no business requiring.
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const [error, setError] = useState<string | null>(null)
  // React 18 mounts effects twice in development; opening two pickers over
  // each other is visible, so the open is guarded rather than cleaned up.
  const opened = useRef(false)

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    const config = getDrivePicker()
    if (config.mode !== 'google') return
    dispatchAction<{ accessToken: string }>('drive.pickerToken', {})
      .then(({ accessToken }) =>
        openGooglePicker({
          apiKey: config.apiKey,
          appId: config.appId,
          accessToken,
          kind,
          locale,
        }),
      )
      .then(picked => (picked ? onPick(picked) : onCancel()))
      .catch(() => setError(t('drive.picker.failed')))
  }, [kind, locale, onCancel, onPick, t])

  if (error)
    return (
      <Notice
        title={t('drive.picker.dialog')}
        message={error}
        onCancel={onCancel}
        onReconnect={onReconnect}
      />
    )

  // Google's chooser is an iframe on docs.google.com, so it needs its own
  // third-party cookies to find the user's Google session. Browsers that block
  // them — Brave with Shields up, Safari, Firefox, Chrome incognito — get
  // Google's bare "You must sign in to access this content" instead of their
  // files, with nothing to say the browser did it. The app cannot detect this
  // (the iframe loads fine, so no error reaches us) and cannot work around it,
  // so it says so underneath the picker while the picker is the thing on
  // screen. Pointer events off: this is a caption, never a target.
  return (
    <Portal>
      <p className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] mx-auto max-w-md rounded-md bg-slate-900/85 px-4 py-2 text-center text-xs text-white">
        {t('drive.picker.cookieHint')}
      </p>
    </Portal>
  )
}

/** A small dialog for the cases where no chooser can open. */
function Notice({
  title,
  message,
  onCancel,
  onReconnect,
}: {
  title: string
  message: string
  onCancel: () => void
  onReconnect?: () => void
}) {
  const { t } = useTranslation()
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
          aria-label={title}
          className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
        >
          <p className="text-sm text-slate-700">{message}</p>
          <div className="mt-4 flex justify-end gap-2">
            {onReconnect && (
              <button
                type="button"
                onClick={onReconnect}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-slate-50"
              >
                {t('quiz.reconnect')}
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/**
 * The fallback finder: navigate the fabricated tree by breadcrumb, then either
 * confirm the folder you are standing in or click the file you came for.
 */
function MockPicker({
  kind,
  title,
  confirmLabel,
  busyLabel,
  busy,
  onPick,
  onCancel,
  onReconnect,
}: Props) {
  const { t } = useTranslation()
  // Rooted at My Drive — a Google product name, so it is not translated.
  const [path, setPath] = useState<DriveFolder[]>([
    { id: 'root', name: 'My Drive' },
  ])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [files, setFiles] = useState<DriveImportable[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const current = path[path.length - 1]!

  useEffect(() => {
    let ignore = false
    const request =
      kind === 'folder'
        ? dispatchAction<{ folders: DriveFolder[] }>('quiz.driveFolders', {
            parentId: current.id,
          }).then(r => ({ folders: r.folders, files: [] as DriveImportable[] }))
        : dispatchAction<{ folders: DriveFolder[]; files: DriveImportable[] }>(
            'drive.importables',
            { parentId: current.id },
          )
    request
      .then(r => {
        if (ignore) return
        setFolders(r.folders)
        setFiles(r.files)
        setLoadedFor(current.id)
        setError(null)
      })
      .catch(() => {
        if (!ignore) setError(t('quiz.errors.loadFolders'))
      })
    return () => {
      ignore = true
    }
  }, [current.id, kind, t])

  const loading = loadedFor !== current.id
  const empty = folders.length === 0 && files.length === 0

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
          aria-label={t('drive.picker.dialog')}
          className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-lg bg-white p-6 shadow-xl"
        >
          <header className="mb-3 flex items-start justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
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
              aria-label={t('drive.picker.path')}
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
                    onClick={() => setPath(p => p.slice(0, i + 1))}
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
              ) : empty ? (
                <p className="p-3 text-sm text-slate-400">
                  {kind === 'folder'
                    ? t('drive.picker.emptyFolders')
                    : t('drive.picker.emptyFiles')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {folders.map(f => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setPath(p => [...p, f])}
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
                  {files.map(f => {
                    const Icon = f.mimeType.includes('presentation')
                      ? Presentation
                      : FileText
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => onPick(f)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50"
                        >
                          <Icon
                            className="h-4 w-4 shrink-0 text-slate-400"
                            aria-hidden
                          />
                          <span className="flex-1 truncate">{f.name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
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
              {kind === 'folder' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(asItem(current))}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? busyLabel : confirmLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export default function DrivePicker(props: Props) {
  const { t } = useTranslation()
  const mode = getDrivePicker().mode
  if (mode === 'google') return <GooglePickerHost {...props} />
  if (mode === 'mock') return <MockPicker {...props} />
  return (
    <Notice
      title={t('drive.picker.dialog')}
      message={t('drive.picker.unavailable')}
      onCancel={props.onCancel}
    />
  )
}
