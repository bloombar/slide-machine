/**
 * Modal for creating a project: a required title and an optional
 * description. Submit creates the project and hands it back to the caller
 * (which navigates to its page); Cancel and Escape dismiss without change.
 * Focus lands on the title field.
 */
import { useRef, useState, type FormEvent } from 'react'
import type { Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import Modal from './Modal'

interface Props {
  onCreated: (project: Project) => void
  onCancel: () => void
}

export default function NewProjectModal({ onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const project = await dispatchAction<Project>('project.create', {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      onCreated(project)
    } catch {
      setError('Could not create the project')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      ariaLabelledBy="new-project-title"
      size="sm"
      onClose={onCancel}
      initialFocusRef={titleRef}
    >
      <form onSubmit={onSubmit}>
        <h3 id="new-project-title" className="text-lg font-bold">
          New project
        </h3>

        <label
          htmlFor="new-project-name"
          className="mt-4 block text-sm font-medium text-slate-700"
        >
          Title
        </label>
        <input
          id="new-project-name"
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Biology 101"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />

        <label
          htmlFor="new-project-description"
          className="mt-4 block text-sm font-medium text-slate-700"
        >
          Description <span className="text-slate-400">(optional)</span>
        </label>
        <textarea
          id="new-project-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          placeholder="What is this project about?"
          className="mt-1 w-full resize-none rounded-md border border-slate-300 px-3 py-2"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Create project
          </button>
        </div>
      </form>
    </Modal>
  )
}
