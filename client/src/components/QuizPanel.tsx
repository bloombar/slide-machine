/**
 * Quiz tab of the lecture settings (SPEC QUIZ-1..4). It walks the instructor
 * through publishing an exit-ticket quiz as a Google Form:
 *   1. connect a Google account (if not already),
 *   2. pick the Drive folder to save the Form in,
 *   3. generate + publish, then show the shareable URL with a copy button.
 *
 * The Google steps are mock-backed on the server for now; this UI does not
 * change when they become real.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, X } from 'lucide-react'
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

/** Modal that lists the instructor's Drive folders and publishes on continue. */
function FolderPicker({
  onCancel,
  onPublish,
  publishing,
}: {
  onCancel: () => void
  onPublish: (folder: DriveFolder) => void
  publishing: boolean
}) {
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dispatchAction<{ folders: DriveFolder[] }>('quiz.driveFolders', {})
      .then(r => {
        setFolders(r.folders)
        setSelected(r.folders[0]?.id ?? '')
      })
      .catch(() => setError('Could not load your Drive folders'))
  }, [])

  const chosen = folders?.find(f => f.id === selected)

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
          className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
        >
          <header className="mb-4 flex items-start justify-between">
            <h2 className="text-lg font-bold">Save the quiz to…</h2>
            <button
              aria-label="Close"
              onClick={onCancel}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          {error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : !folders ? (
            <p className="text-sm text-slate-500">Loading your folders…</p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm text-slate-600">
                Choose the Google Drive folder for the Form:
              </legend>
              {folders.map(f => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm has-checked:border-indigo-400 has-checked:bg-indigo-50"
                >
                  <input
                    type="radio"
                    name="drive-folder"
                    value={f.id}
                    checked={selected === f.id}
                    onChange={() => setSelected(f.id)}
                  />
                  {f.name}
                </label>
              ))}
            </fieldset>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!chosen || publishing}
              onClick={() => onPublish(chosen!)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {publishing ? 'Generating…' : 'Continue'}
            </button>
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    dispatchAction<QuizStatus>('quiz.status', { deckId })
      .then(s => {
        setConnected(s.googleConnected)
        setQuiz(s.quiz)
      })
      .catch(() => setError('Could not load the quiz status'))
      .finally(() => setLoading(false))
  }, [deckId])

  const connectGoogle = () => {
    setBusy(true)
    setError(null)
    dispatchAction<QuizConnectResult>('quiz.connectGoogle', {
      returnTo: window.location.href,
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
    })
      .then(q => {
        setQuiz(q)
        setPicking(false)
      })
      .catch(() => setError('Could not generate the quiz — please try again'))
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
            onClick={() => setPicking(true)}
            className="mt-1 self-start text-sm font-medium text-indigo-600 hover:underline"
          >
            Regenerate
          </button>
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
        />
      )}
    </div>
  )
}
