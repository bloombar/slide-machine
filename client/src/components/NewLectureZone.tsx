/**
 * The "New lecture" affordance shared by the home screen and a project
 * page: a dashed row, pinned to the top of a lecture list, whose
 * link-styled button starts a new untitled lecture in the project. When an
 * `onImport` handler is given, it also offers "Import" to create a lecture
 * from a previously exported deck YAML file (EXP-3).
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Upload } from 'lucide-react'

interface Props {
  /** Names the target project in the label; omitted in the empty-state
   * zone shown before the user has any project. */
  projectTitle?: string
  onStart: () => void
  /** Receives a chosen deck-export file to import as a new lecture (EXP-3).
   * When omitted, the import affordance is hidden. */
  onImport?: (file: File) => void
}

export default function NewLectureZone({
  projectTitle,
  onStart,
  onImport,
}: Props) {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)

  /** Forwards the picked file, then resets the input so the same file can be
   * chosen again if a retry is needed. */
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImport?.(file)
    e.target.value = ''
  }

  return (
    <li className="flex items-center justify-center gap-4 rounded-md border border-dashed border-slate-300 px-4 py-2 hover:border-slate-400 hover:bg-slate-50">
      <button
        aria-label={
          projectTitle
            ? t('lecture.new.inProject', { project: projectTitle })
            : t('lecture.new.label')
        }
        onClick={onStart}
        className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t('lecture.new.action')}
      </button>
      {onImport && (
        <>
          <span className="text-slate-300" aria-hidden>
            |
          </span>
          <button
            aria-label={
              projectTitle
                ? t('lecture.import.intoProject', { project: projectTitle })
                : t('lecture.import.label')
            }
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t('lecture.import.action')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={onFileChange}
          />
        </>
      )}
    </li>
  )
}
