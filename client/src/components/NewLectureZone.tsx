/**
 * The "New lecture" affordance shared by the home screen and a project
 * page: a dashed row, pinned to the top of a lecture list, that starts a
 * new untitled lecture in the project. The button fills the row, so the
 * whole dashed area is the click target rather than just its label.
 *
 * Starting a lecture is the only thing here. Importing one (EXP-3) lives
 * in the "+" menu beside the heading above, so this row stays a single,
 * obvious call to action.
 */
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

interface Props {
  /** Names the target project in the label; omitted in the empty-state
   * zone shown before the user has any project. */
  projectTitle?: string
  onStart: () => void
}

export default function NewLectureZone({ projectTitle, onStart }: Props) {
  const { t } = useTranslation()

  return (
    <li className="rounded-md border border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-50">
      <button
        aria-label={
          projectTitle
            ? t('lecture.new.inProject', { project: projectTitle })
            : t('lecture.new.label')
        }
        onClick={onStart}
        className="flex w-full items-center justify-center gap-1 rounded-md px-4 py-2 text-sm font-medium text-indigo-600 hover:underline"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t('lecture.new.action')}
      </button>
    </li>
  )
}
