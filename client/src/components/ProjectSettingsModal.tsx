/**
 * Project settings as a full-width modal, mirroring the lecture
 * settings chrome: seed notes and seed material (which apply to every
 * lecture in the project, PROJ-1/SEED-1) plus an owner Danger zone that
 * deletes the whole project — lectures, slides, and seed material —
 * after an in-app confirmation. Closes from the top-right icon or the
 * Escape key.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import ConfirmDialog from './ConfirmDialog'

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

interface Props {
  project: Project
  onClose: () => void
  /** Fired after a successful save so the page keeps a fresh project. */
  onProjectChange: (project: Project) => void
  /** Fired after the project is deleted; the page leaves for home. */
  onDeleted: () => void
}

export default function ProjectSettingsModal({
  project,
  onClose,
  onProjectChange,
  onDeleted,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape closes (unless typing in a field); focus lands on close
  useEffect(() => {
    closeRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const deleteProject = () => {
    dispatchAction('project.delete', { projectId: project.id })
      .then(() => {
        setConfirmingDelete(false)
        onDeleted()
      })
      .catch(() => {
        // Quiet failure: the project simply stays
        setConfirmingDelete(false)
      })
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project settings"
        className="fixed inset-x-0 top-14 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="mx-auto w-full max-w-5xl">
          <header className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold">Project settings</h2>
            <button
              ref={closeRef}
              aria-label="Close settings"
              title="Close (Esc)"
              onClick={onClose}
              className="rounded-md p-2 text-slate-500 hover:text-slate-900"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex flex-col gap-8">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                Seed notes
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                Background material that guides slide generation for every
                lecture in this project. Saved automatically.
              </p>
              <SeedNotesEditor
                value={project.seedContext ?? ''}
                label="Project seed notes"
                placeholder="Key topics, terminology, planned structure…"
                onSave={seedContext => {
                  dispatchAction<Project>('project.update', {
                    projectId: project.id,
                    seedContext,
                  })
                    .then(onProjectChange)
                    .catch(() => {
                      // Quiet failure: the next keystroke retries
                    })
                }}
              />
            </div>

            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                Seed material
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                Documents and photos scanned for background text and imagery,
                available to every lecture in this project.
              </p>
              <SeedMaterial projectId={project.id} />
            </div>

            <div className="rounded-md border border-red-200 p-4">
              <h3 className="mb-2 text-lg font-semibold text-red-700">
                Danger zone
              </h3>
              <p className="mb-3 text-sm text-slate-600">
                Deleting a project permanently removes all of its lectures,
                slides, and seed material. This cannot be undone.
              </p>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Delete project
              </button>
            </div>
          </div>

          {confirmingDelete && (
            <ConfirmDialog
              title="Delete project?"
              message={`"${project.title}" and all of its lectures, slides, and seed material will be permanently deleted.`}
              confirmLabel="Delete"
              onConfirm={deleteProject}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
        </div>
      </div>
    </>
  )
}
