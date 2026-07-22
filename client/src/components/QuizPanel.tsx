/**
 * Quiz tab of the lecture settings (SPEC QUIZ-1..6). It walks the instructor
 * through publishing an exit-ticket quiz as a Google Form:
 *   1. connect a Google account (if not already),
 *   2. pick the Drive folder to save the Form in, optionally folding in the
 *      spoken transcript as well as the slides (QUIZ-5),
 *   3. generate + publish, then show the shareable URL with a copy button.
 *
 * The published quiz can be deleted; regenerating afterwards produces a
 * different set of questions (QUIZ-6). The server runs these steps mock- or
 * live-backed per config; this UI is identical either way.
 */
import { useEffect, useState } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FolderPlus,
  Trash2,
  X,
} from 'lucide-react'
import type {
  DriveFolder,
  PublishedQuiz,
  QuizConnectResult,
  QuizStatus,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import Portal from './Portal'

interface Props {
  deckId: string
}

/**
 * Finder-style Google Drive folder browser (QUIZ-2). Navigate into folders via
 * the breadcrumb, create new ones, and save the quiz into whichever folder
 * you're in. Under the current `drive.file` scope this shows the folders the
 * app created; once `drive.readonly` is granted (server-side) and the user
 * reconnects, the very same views browse the whole Drive — no UI change.
 */
function FolderPicker({
  onCancel,
  onPublish,
  publishing,
  hasTranscript,
  includeTranscript,
  onIncludeTranscriptChange,
}: {
  onCancel: () => void
  onPublish: (folder: DriveFolder) => void
  publishing: boolean
  hasTranscript: boolean
  includeTranscript: boolean
  onIncludeTranscriptChange: (value: boolean) => void
}) {
  // The breadcrumb; the last entry is the folder currently open (the one a
  // quiz would be saved into). Always rooted at My Drive.
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

  // Load the current folder's sub-folders. All state updates happen in the
  // async callbacks (never synchronously in the effect); `loadedFor` marks
  // which folder `folders` belongs to, giving a loading state without a
  // synchronous reset (and no flash of the previous folder's contents).
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
        if (!ignore) setError('Could not load your Drive folders')
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
        // Step into the new folder so "Save here" saves the quiz into it.
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
            <h2 className="text-lg font-bold">Save the quiz to…</h2>
            <button
              aria-label="Close"
              onClick={onCancel}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          {/* Breadcrumb of the current folder path */}
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

          {/* Finder body: the sub-folders of the current folder */}
          <div className="min-h-[8rem] flex-1 overflow-y-auto rounded-md border border-slate-200">
            {error ? (
              <p className="p-3 text-sm text-rose-600">{error}</p>
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

          {/* Create a new folder inside the current one */}
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

          {hasTranscript && (
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeTranscript}
                onChange={e => onIncludeTranscriptChange(e.target.checked)}
              />
              <span>
                Include the spoken transcript
                <span className="block text-xs text-slate-500">
                  Draw questions from what you said aloud too, not just the
                  slides.
                </span>
              </span>
            </label>
          )}

          <div className="mt-5 flex items-center justify-between gap-2">
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
                disabled={publishing}
                onClick={() => onPublish(current)}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {publishing ? 'Generating…' : 'Save here'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export default function QuizPanel({ deckId }: Props) {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [quiz, setQuiz] = useState<PublishedQuiz | undefined>(undefined)
  const [hasTranscript, setHasTranscript] = useState(false)
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    dispatchAction<QuizStatus>('quiz.status', { deckId })
      .then(s => {
        setConnected(s.googleConnected)
        setQuiz(s.quiz)
        setHasTranscript(s.hasTranscript)
      })
      .catch(() => setError('Could not load the quiz status'))
      .finally(() => setLoading(false))
  }, [deckId])

  const connectGoogle = () => {
    setBusy(true)
    setError(null)
    // Come back to THIS lecture with the Quiz tab reopened. OAuth is a full
    // page load, so we signal the tab via a URL param (router state is lost).
    const returnTo = new URL(window.location.href)
    returnTo.searchParams.set('settings', 'quiz')
    dispatchAction<QuizConnectResult>('quiz.connectGoogle', {
      returnTo: returnTo.toString(),
    })
      .then(res => {
        if (res.status === 'redirect') {
          // Live mode: hand off to Google's consent screen
          window.location.href = res.url
        } else {
          setConnected(true)
          setBusy(false)
        }
      })
      .catch(() => {
        setError('Could not connect your Google account')
        setBusy(false)
      })
  }

  const publish = (folder: DriveFolder) => {
    setBusy(true)
    setError(null)
    dispatchAction<PublishedQuiz>('quiz.publish', {
      deckId,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
      includeTranscript,
    })
      .then(q => {
        setQuiz(q)
        setPicking(false)
      })
      .catch(() => setError('Could not generate the quiz — please try again'))
      .finally(() => setBusy(false))
  }

  const remove = () => {
    setBusy(true)
    setError(null)
    dispatchAction<{ deleted: boolean }>('quiz.delete', { deckId })
      .then(() => setQuiz(undefined))
      .catch(() => setError('Could not delete the quiz — please try again'))
      .finally(() => setBusy(false))
  }

  const copyLink = (url: string) => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Exit-ticket quiz
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Generate a quiz from this lecture and publish it as a Google Form you
          can share with students.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {quiz ? (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-4">
          <span className="text-sm font-medium text-slate-700">
            Your quiz is ready
          </span>
          <div className="flex items-center gap-2">
            <a
              href={quiz.formUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-indigo-600 hover:underline"
            >
              <span className="truncate">{quiz.formUrl}</span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
            <button
              aria-label={copied ? 'Link copied' : 'Copy quiz link'}
              onClick={() => copyLink(quiz.formUrl)}
              className="rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:text-slate-900"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="mt-2 inline-flex items-center gap-1.5 self-start rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {busy ? 'Deleting…' : 'Delete quiz'}
          </button>
          <p className="text-xs text-slate-500">
            Deleting lets you generate a fresh quiz with different questions.
          </p>
        </div>
      ) : connected ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          Generate quiz
        </button>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-slate-600">
            Connect a Google account so the Form can be saved to your Google
            Drive.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={connectGoogle}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect Google'}
          </button>
        </div>
      )}

      {picking && (
        <FolderPicker
          publishing={busy}
          onCancel={() => setPicking(false)}
          onPublish={publish}
          hasTranscript={hasTranscript}
          includeTranscript={includeTranscript}
          onIncludeTranscriptChange={setIncludeTranscript}
        />
      )}
    </div>
  )
}
