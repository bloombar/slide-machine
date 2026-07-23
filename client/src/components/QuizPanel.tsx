/**
 * Quiz tab of the lecture settings (SPEC QUIZ-1..6). It walks the instructor
 * through publishing an exit-ticket quiz as a Google Form:
 *   1. connect a Google account (if not already),
 *   2. pick the Drive folder to save the Form in and set generation options —
 *      number of questions and total points, plus Advanced settings for email
 *      collection, the spoken transcript, per-type question counts, and free-
 *      text AI instructions (QUIZ-5/QUIZ-7),
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
  QuizGenerationOptions,
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
const QUESTION_TYPE_FIELDS = [
  { key: 'single_choice', label: 'Single-choice (MCQ)' },
  { key: 'multiple_choice', label: 'Multiple-answer' },
  { key: 'short_text', label: 'Short answer' },
  { key: 'long_text', label: 'Long answer' },
] as const

type TypeCounts = Record<(typeof QUESTION_TYPE_FIELDS)[number]['key'], number>

function FolderPicker({
  onCancel,
  onPublish,
  publishing,
  hasTranscript,
}: {
  onCancel: () => void
  onPublish: (folder: DriveFolder, options: QuizGenerationOptions) => void
  publishing: boolean
  hasTranscript: boolean
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

  // Generation options (QUIZ-5/QUIZ-7). Basic: count + points. Advanced:
  // require email, transcript, per-type counts, and free-text AI instructions.
  const [questionCount, setQuestionCount] = useState(5)
  const [totalPoints, setTotalPoints] = useState('')
  const [requireEmail, setRequireEmail] = useState(true)
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [types, setTypes] = useState<TypeCounts>({
    single_choice: 0,
    multiple_choice: 0,
    short_text: 0,
    long_text: 0,
  })
  const [customInstructions, setCustomInstructions] = useState('')

  const typeTotal = Object.values(types).reduce((sum, n) => sum + n, 0)
  // Per-type counts only take effect when Advanced is open and any are set.
  const typesUsed = advanced && typeTotal > 0
  const mismatch = typesUsed && typeTotal !== questionCount

  const buildOptions = (): QuizGenerationOptions => ({
    questionCount,
    totalPoints: totalPoints ? Number(totalPoints) : undefined,
    requireEmail,
    includeTranscript,
    typeCounts: typesUsed ? types : undefined,
    customInstructions: customInstructions.trim() || undefined,
  })

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

          {/* Scrollable content; the footer below stays fixed */}
          <div className="flex-1 overflow-y-auto pr-1">
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
            <div className="max-h-44 min-h-[6rem] overflow-y-auto rounded-md border border-slate-200">
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

            {/* Basic generation options */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm text-slate-700">
                Number of questions
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={questionCount}
                  onChange={e =>
                    setQuestionCount(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm text-slate-700">
                Total points
                <input
                  type="number"
                  min={1}
                  value={totalPoints}
                  placeholder="auto"
                  onChange={e => setTotalPoints(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>

            {/* Advanced settings */}
            <button
              type="button"
              onClick={() => setAdvanced(a => !a)}
              aria-expanded={advanced}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${advanced ? 'rotate-90' : ''}`}
                aria-hidden
              />
              Advanced settings
            </button>

            {advanced && (
              <div className="mt-2 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={requireEmail}
                    onChange={e => setRequireEmail(e.target.checked)}
                  />
                  Require a verified respondent email
                </label>

                {hasTranscript && (
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={includeTranscript}
                      onChange={e => setIncludeTranscript(e.target.checked)}
                    />
                    <span>
                      Include the spoken transcript
                      <span className="block text-xs text-slate-500">
                        Draw questions from what you said aloud too, not just
                        the slides.
                      </span>
                    </span>
                  </label>
                )}

                <fieldset>
                  <legend className="text-sm text-slate-700">
                    Question types (leave all 0 to let the AI decide)
                  </legend>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {QUESTION_TYPE_FIELDS.map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2 text-sm text-slate-700"
                      >
                        {label}
                        <input
                          type="number"
                          min={0}
                          max={50}
                          aria-label={label}
                          value={types[key]}
                          onChange={e =>
                            setTypes(t => ({
                              ...t,
                              [key]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ))}
                  </div>
                  {mismatch && (
                    <p className="mt-1 text-xs text-amber-600">
                      The type counts add up to {typeTotal}, not {questionCount}
                      . The quiz will have {typeTotal} question
                      {typeTotal === 1 ? '' : 's'}.
                    </p>
                  )}
                </fieldset>

                <label className="text-sm text-slate-700">
                  AI instructions (optional)
                  <textarea
                    value={customInstructions}
                    onChange={e => setCustomInstructions(e.target.value)}
                    rows={2}
                    placeholder="e.g. focus on the water cycle; avoid definitions"
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            )}
          </div>
          {/* Fixed footer */}
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
                disabled={publishing}
                onClick={() => onPublish(current, buildOptions())}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {publishing ? 'Generating…' : 'Generate & save'}
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

  const publish = (folder: DriveFolder, options: QuizGenerationOptions) => {
    setBusy(true)
    setError(null)
    dispatchAction<PublishedQuiz>('quiz.publish', {
      deckId,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
      ...options,
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
        />
      )}
    </div>
  )
}
