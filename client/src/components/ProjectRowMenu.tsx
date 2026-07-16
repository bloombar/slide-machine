/**
 * Kebab menu beside a project on the home screen: Settings and Share
 * deep-link to the project page's settings modal (General and Privacy &
 * Sharing tabs), and Delete removes the project after confirming. Only
 * owned projects are listed on home, so every action is available.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MoreVertical } from 'lucide-react'
import type { Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import ConfirmDialog from './ConfirmDialog'

export default function ProjectRowMenu({
  project,
  onDeleted,
}: {
  project: Project
  onDeleted: (projectId: string) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Outside clicks and Escape close the menu
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openSettings = (settingsTab: 'general' | 'sharing') => {
    setOpen(false)
    navigate(`/app/projects/${project.id}`, {
      state: { openSettings: true, settingsTab },
    })
  }

  const deleteProject = () => {
    dispatchAction('project.delete', { projectId: project.id })
      .then(() => {
        setConfirming(false)
        onDeleted(project.id)
      })
      .catch(() => {
        // Quiet failure: the project simply stays
        setConfirming(false)
      })
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        aria-label={`Options for ${project.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Options for ${project.title}`}
          className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            role="menuitem"
            onClick={() => openSettings('general')}
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Settings
          </button>
          <button
            role="menuitem"
            onClick={() => openSettings('sharing')}
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Share
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setConfirming(true)
            }}
            className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete project?"
          message={`"${project.title}" and all of its lectures, slides, and seed material will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={deleteProject}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
