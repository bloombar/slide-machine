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
import { useTranslation } from 'react-i18next'
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
  QuizEmailCollection,
  QuizGenerationOptions,
  QuizQuestion,
  QuizStatus,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
// The singleton's standalone translator, for the load effects below: it
// is module-level and stable, so it is not an effect dependency the way
// the hook's `t` is (which changes identity on every language switch,
// and would re-run the fetch).
import { t as translate } from '../i18n'
import Portal from './Portal'

interface Props {
  deckId: string
}

/** The question types offered, in order. Each key names its own field
 * label under `quiz.types.<key>.field` and its preview label under
 * `quiz.types.<key>.name`. */
const QUESTION_TYPE_FIELDS = [
  'single_choice',
  'multiple_choice',
  'short_text',
  'long_text',
] as const

type TypeCounts = Record<(typeof QUESTION_TYPE_FIELDS)[number], number>

/** The per-type counts to start from: the project's remembered breakdown, else
 * its remembered count as all single-choice, else five single-choice (QUIZ-2). */
const initialTypeCounts = (defaults?: QuizGenerationOptions): TypeCounts => {
  const tc = defaults?.typeCounts
  if (
    tc &&
    (tc.single_choice || tc.multiple_choice || tc.short_text || tc.long_text)
  ) {
    return {
      single_choice: tc.single_choice ?? 0,
      multiple_choice: tc.multiple_choice ?? 0,
      short_text: tc.short_text ?? 0,
      long_text: tc.long_text ?? 0,
    }
  }
  const n = defaults?.questionCount ?? 5
  return { single_choice: n, multiple_choice: 0, short_text: 0, long_text: 0 }
}

/**
 * The quiz generation options (QUIZ-5/QUIZ-7), owned by the caller so they
 * outlive the folder picker and survive the review step (QUIZ-2 — cancelling
 * review must not wipe what the instructor typed). The per-type counts are the
 * source of truth; "Number of questions" is simply their sum, defaulting to all
 * single-choice, so the two can never disagree.
 */
function useQuizOptions(defaults?: QuizGenerationOptions) {
  const [totalPoints, setTotalPoints] = useState(
    defaults?.totalPoints ? String(defaults.totalPoints) : '',
  )
  const [emailCollection, setEmailCollection] = useState<QuizEmailCollection>(
    defaults?.emailCollection ?? 'verified',
  )
  const [includeTranscript, setIncludeTranscript] = useState(
    defaults?.includeTranscript ?? false,
  )
  const [advanced, setAdvanced] = useState(false)
  const [types, setTypes] = useState<TypeCounts>(() =>
    initialTypeCounts(defaults),
  )
  // "Number of questions" is a free-text field so it can be cleared and
  // retyped; it stays in step with the per-type counts (default all single).
  const [countText, setCountText] = useState(() =>
    String(
      Object.values(initialTypeCounts(defaults)).reduce((a, b) => a + b, 0),
    ),
  )
  const [customInstructions, setCustomInstructions] = useState(
    defaults?.customInstructions ?? '',
  )

  const questionCount = Object.values(types).reduce((sum, n) => sum + n, 0)

  // Editing "Number of questions": fill the difference with single-choice.
  // Empty is allowed while typing; onBlur snaps it back to the real total.
  const onCountChange = (v: string) => {
    setCountText(v)
    const n = Number(v)
    if (v.trim() !== '' && Number.isInteger(n) && n >= 0) {
      setTypes(t => ({
        ...t,
        single_choice: Math.max(
          0,
          n - (t.multiple_choice + t.short_text + t.long_text),
        ),
      }))
    }
  }
  const onCountBlur = () => {
    if (questionCount < 1) {
      setTypes(t => ({ ...t, single_choice: 1 }))
      setCountText('1')
    } else {
      setCountText(String(questionCount))
    }
  }
  // Editing a per-type count updates the "Number of questions" total to match.
  const onTypeChange = (key: keyof TypeCounts, raw: string) => {
    const val = Math.max(0, Number(raw) || 0)
    const next = { ...types, [key]: val }
    setTypes(next)
    setCountText(
      String(
        next.single_choice +
          next.multiple_choice +
          next.short_text +
          next.long_text,
      ),
    )
  }

  const buildOptions = (): QuizGenerationOptions => ({
    questionCount,
    totalPoints: totalPoints ? Number(totalPoints) : undefined,
    emailCollection,
    includeTranscript,
    typeCounts: types,
    customInstructions: customInstructions.trim() || undefined,
  })

  return {
    totalPoints,
    setTotalPoints,
    emailCollection,
    setEmailCollection,
    includeTranscript,
    setIncludeTranscript,
    advanced,
    setAdvanced,
    types,
    countText,
    onCountChange,
    onCountBlur,
    onTypeChange,
    customInstructions,
    setCustomInstructions,
    buildOptions,
  }
}

type QuizOptions = ReturnType<typeof useQuizOptions>

/**
 * Finder-style Google Drive folder browser (QUIZ-2). Navigate into folders via
 * the breadcrumb, create new ones, and save the quiz into whichever folder
 * you're in. Under the current `drive.file` scope this shows the folders the
 * app created; once `drive.readonly` is granted (server-side) and the user
 * reconnects, the very same views browse the whole Drive — no UI change.
 */
function FolderPicker({
  onCancel,
  onGenerate,
  onReconnect,
  publishing,
  hasTranscript,
  options,
}: {
  onCancel: () => void
  onGenerate: (folder: DriveFolder) => void
  onReconnect: () => void
  publishing: boolean
  hasTranscript: boolean
  /** Generation options, owned by the parent so they survive the review step. */
  options: QuizOptions
}) {
  const {
    totalPoints,
    setTotalPoints,
    emailCollection,
    setEmailCollection,
    includeTranscript,
    setIncludeTranscript,
    advanced,
    setAdvanced,
    types,
    countText,
    onCountChange,
    onCountBlur,
    onTypeChange,
    customInstructions,
    setCustomInstructions,
  } = options
  const { t } = useTranslation()

  // The breadcrumb; the last entry is the folder currently open (the one a
  // quiz would be saved into). Always rooted at My Drive — a Google product
  // name, so it is not translated.
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
        // Step into the new folder so "Save here" saves the quiz into it.
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
            <h2 className="text-lg font-bold">{t('quiz.folder.title')}</h2>
            <button
              aria-label={t('common.close')}
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

            {/* Finder body: the sub-folders of the current folder */}
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
                  {t('quiz.folder.empty')}
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

            {/* Create a new folder inside the current one */}
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

            {/* Basic generation options */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm text-slate-700">
                {t('quiz.options.questionCount')}
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={countText}
                  onChange={e => onCountChange(e.target.value)}
                  onBlur={onCountBlur}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm text-slate-700">
                {t('quiz.options.totalPoints')}
                <input
                  type="number"
                  min={1}
                  value={totalPoints}
                  placeholder="100"
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
              {t('quiz.options.advanced')}
            </button>

            {advanced && (
              <div className="mt-2 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <label className="text-sm text-slate-700">
                  {t('quiz.options.email.label')}
                  <select
                    value={emailCollection}
                    onChange={e =>
                      setEmailCollection(
                        e.target.value as typeof emailCollection,
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="verified">
                      {t('quiz.options.email.verified')}
                    </option>
                    <option value="responder_input">
                      {t('quiz.options.email.responderInput')}
                    </option>
                    <option value="none">{t('quiz.options.email.none')}</option>
                  </select>
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
                      {t('quiz.options.transcript.label')}
                      <span className="block text-xs text-slate-500">
                        {t('quiz.options.transcript.hint')}
                      </span>
                    </span>
                  </label>
                )}

                <fieldset>
                  <legend className="text-sm text-slate-700">
                    {t('quiz.options.types')}
                  </legend>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {QUESTION_TYPE_FIELDS.map(key => (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2 text-sm text-slate-700"
                      >
                        {t(`quiz.types.${key}.field`)}
                        <input
                          type="number"
                          min={0}
                          max={50}
                          aria-label={t(`quiz.types.${key}.field`)}
                          placeholder="0"
                          value={types[key] || ''}
                          onChange={e => onTypeChange(key, e.target.value)}
                          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('quiz.options.typesHint')}
                  </p>
                </fieldset>

                <label className="text-sm text-slate-700">
                  {t('quiz.options.instructions.label')}
                  <span className="block text-xs text-slate-500">
                    {t('quiz.options.instructions.hint')}
                  </span>
                  <textarea
                    value={customInstructions}
                    onChange={e => setCustomInstructions(e.target.value)}
                    rows={2}
                    placeholder={t('quiz.options.instructions.placeholder')}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            )}
          </div>
          {/* Fixed footer */}
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
                disabled={publishing}
                onClick={() => onGenerate(current)}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {publishing ? t('quiz.generating') : t('quiz.generateAndSave')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/**
 * Review-before-publish step (QUIZ-2): shows the generated questions and lets
 * the instructor override each one's points before the Form is created.
 */
function QuizPreview({
  questions,
  folderName,
  publishing,
  onPublish,
  onCancel,
}: {
  questions: QuizQuestion[]
  folderName: string
  publishing: boolean
  onPublish: (reviewed: QuizQuestion[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [edited, setEdited] = useState<QuizQuestion[]>(questions)
  const total = edited.reduce((sum, q) => sum + (q.points ?? 0), 0)

  const setPoints = (index: number, raw: string) => {
    const points = Math.max(0, Number(raw) || 0)
    setEdited(qs => qs.map((q, i) => (i === index ? { ...q, points } : q)))
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
          aria-label={t('quiz.review.dialog')}
          className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white p-6 shadow-xl"
        >
          <header className="mb-1 flex items-start justify-between">
            <h2 className="text-lg font-bold">{t('quiz.review.title')}</h2>
            <button
              aria-label={t('common.close')}
              onClick={onCancel}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>
          <p className="mb-3 text-sm text-slate-600">
            {t('quiz.review.hint')}{' '}
            <span className="font-medium text-slate-800">{total}</span>
          </p>

          <ol className="flex-1 space-y-3 overflow-y-auto pr-1">
            {edited.map((q, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-md border border-slate-200 p-3"
              >
                <span className="mt-0.5 text-sm font-semibold text-slate-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">{q.question}</p>
                  <span className="text-xs uppercase tracking-wide text-slate-400">
                    {t(`quiz.types.${q.type}.name`, { defaultValue: q.type })}
                  </span>
                </div>
                <label className="shrink-0 text-xs text-slate-500">
                  {t('quiz.review.points')}
                  <input
                    type="number"
                    min={0}
                    aria-label={t('quiz.review.pointsFor', { number: i + 1 })}
                    value={q.points ?? 0}
                    onChange={e => setPoints(i, e.target.value)}
                    className="mt-0.5 w-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                  />
                </label>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <span className="min-w-0 truncate text-xs text-slate-500">
              {t('quiz.savingTo')}{' '}
              <span className="font-medium text-slate-700">{folderName}</span>
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
                disabled={publishing}
                onClick={() => onPublish(edited)}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {publishing ? t('quiz.publishing') : t('quiz.publish')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/**
 * Owns the two-step publish flow (QUIZ-2): the folder picker and the review
 * step. The generation options live here — above both dialogs — so cancelling
 * the review returns to the picker with everything the instructor entered still
 * in place, rather than starting over.
 */
function QuizPublishFlow({
  defaults,
  hasTranscript,
  busy,
  onGenerate,
  onPublish,
  onReconnect,
  onClose,
}: {
  defaults?: QuizGenerationOptions
  hasTranscript: boolean
  busy: boolean
  /** Generates the quiz for review; resolves to the questions, or null on error. */
  onGenerate: (options: QuizGenerationOptions) => Promise<QuizQuestion[] | null>
  onPublish: (
    folder: DriveFolder,
    options: QuizGenerationOptions,
    reviewed: QuizQuestion[],
  ) => void
  onReconnect: () => void
  onClose: () => void
}) {
  const options = useQuizOptions(defaults)
  const [phase, setPhase] = useState<'picking' | 'review'>('picking')
  const [folder, setFolder] = useState<DriveFolder | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])

  // "Generate & save": generate for review; on success move to the review step,
  // on failure stay on the picker (options preserved either way).
  const generate = (chosen: DriveFolder) => {
    void onGenerate(options.buildOptions()).then(qs => {
      if (!qs) return
      setFolder(chosen)
      setQuestions(qs)
      setPhase('review')
    })
  }

  if (phase === 'review' && folder) {
    return (
      <QuizPreview
        questions={questions}
        folderName={folder.name}
        publishing={busy}
        onPublish={reviewed =>
          onPublish(folder, options.buildOptions(), reviewed)
        }
        // Back to the picker with the options intact (the point of this flow).
        onCancel={() => setPhase('picking')}
      />
    )
  }
  return (
    <FolderPicker
      publishing={busy}
      hasTranscript={hasTranscript}
      options={options}
      onGenerate={generate}
      onCancel={onClose}
      onReconnect={onReconnect}
    />
  )
}

export default function QuizPanel({ deckId }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [quiz, setQuiz] = useState<PublishedQuiz | undefined>(undefined)
  const [hasTranscript, setHasTranscript] = useState(false)
  const [defaults, setDefaults] = useState<QuizGenerationOptions | undefined>(
    undefined,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The publish flow (folder picker + review) is open. A single flag: the flow
  // itself owns which step it's on and the options entered along the way.
  const [flowOpen, setFlowOpen] = useState(false)
  const [copied, setCopied] = useState(false)
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
    dispatchAction<QuizStatus>('quiz.status', { deckId })
      .then(s => {
        setConnected(s.googleConnected)
        setQuiz(s.quiz)
        setHasTranscript(s.hasTranscript)
        setDefaults(s.defaults)
      })
      .catch(() => setError(translate('quiz.errors.status')))
      .finally(() => setLoading(false))
  }, [deckId])

  const connectGoogle = () => {
    setBusy(true)
    setError(null)
    // Come back to THIS lecture with the Quiz tab reopened. OAuth is a full
    // page load, so we signal the tab via a URL param (router state is lost).
    const returnTo = new URL(window.location.href)
    returnTo.searchParams.set('settings', 'quiz')
    // Don't carry a prior drive-denied flag back, or a SUCCESSFUL reconnect
    // would return to a URL that still shows the banner.
    returnTo.searchParams.delete('connect')
    dispatchAction<QuizConnectResult>('quiz.connectGoogle', {
      returnTo: returnTo.toString(),
    })
      .then(res => {
        if (res.status === 'redirect') {
          // Live mode: hand off to Google's consent screen
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

  // Step 1: generate the quiz (no publish yet) for the review step. Resolves to
  // the questions, or null on failure so the flow can stay on the picker.
  const generate = (
    options: QuizGenerationOptions,
  ): Promise<QuizQuestion[] | null> => {
    setBusy(true)
    setError(null)
    return dispatchAction<{ questions: QuizQuestion[] }>('quiz.generate', {
      deckId,
      ...options,
    })
      .then(({ questions }) => questions)
      .catch(() => {
        setError(t('quiz.errors.generate'))
        return null
      })
      .finally(() => setBusy(false))
  }

  // Step 2: publish the reviewed questions (with any point overrides) as a Form.
  const publish = (
    folder: DriveFolder,
    options: QuizGenerationOptions,
    reviewed: QuizQuestion[],
  ) => {
    setBusy(true)
    setError(null)
    dispatchAction<PublishedQuiz>('quiz.publish', {
      deckId,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
      ...options,
      questions: reviewed,
    })
      .then(q => {
        setQuiz(q)
        setFlowOpen(false)
      })
      .catch(() => setError(t('quiz.errors.publish')))
      .finally(() => setBusy(false))
  }

  const remove = () => {
    setBusy(true)
    setError(null)
    dispatchAction<{ deleted: boolean }>('quiz.delete', { deckId })
      .then(() => setQuiz(undefined))
      .catch(() => setError(t('quiz.errors.delete')))
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
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          {t('quiz.heading')}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{t('quiz.intro')}</p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {driveDenied && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t('quiz.driveDenied', { action: t('quiz.connect') })}
        </p>
      )}

      {quiz ? (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-4">
          <span className="text-sm font-medium text-slate-700">
            {t('quiz.ready')}
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
              aria-label={copied ? t('quiz.linkCopied') : t('quiz.copyLink')}
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
            {busy ? t('quiz.deleting') : t('quiz.delete')}
          </button>
          <p className="text-xs text-slate-500">{t('quiz.deleteHint')}</p>
        </div>
      ) : connected ? (
        <button
          type="button"
          onClick={() => setFlowOpen(true)}
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          {t('quiz.generate')}
        </button>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-slate-600">{t('quiz.connectHint')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={connectGoogle}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t('quiz.connecting') : t('quiz.connect')}
          </button>
        </div>
      )}

      {flowOpen && connected && (
        <QuizPublishFlow
          defaults={defaults}
          hasTranscript={hasTranscript}
          busy={busy}
          onGenerate={generate}
          onPublish={publish}
          onReconnect={connectGoogle}
          onClose={() => setFlowOpen(false)}
        />
      )}
    </div>
  )
}
