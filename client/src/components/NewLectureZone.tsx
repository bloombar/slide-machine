/**
 * The "New lecture" affordance shared by the home screen and a project
 * page: a dashed row, pinned to the top of a lecture list, whose
 * link-styled button starts a new untitled lecture in the project.
 */
import { Plus } from 'lucide-react'

interface Props {
  /** Names the target project in the label; omitted in the empty-state
   * zone shown before the user has any project. */
  projectTitle?: string
  onStart: () => void
}

export default function NewLectureZone({ projectTitle, onStart }: Props) {
  return (
    <li className="rounded-md border border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-50">
      <button
        aria-label={
          projectTitle
            ? `Start a new lecture in ${projectTitle}`
            : 'Start a new lecture'
        }
        onClick={onStart}
        className="flex w-full items-center justify-center gap-1 px-4 py-2 text-sm font-medium text-indigo-600 hover:underline"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New lecture
      </button>
    </li>
  )
}
