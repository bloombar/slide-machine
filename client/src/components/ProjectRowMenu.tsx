/**
 * Kebab menu beside a project on the home screen: Settings and Share
 * deep-link to the project page's settings modal (General and Privacy &
 * Sharing tabs), and Delete removes the project after confirming. Only
 * owned projects are listed on home, so every action is available.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { MoreVertical } from 'lucide-react'
import type { Project } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { projectTitle } from '../lib/project'
import ConfirmDialog from './ConfirmDialog'

export default function ProjectRowMenu({
  project,
  onDeleted,
  onImport,
  onOpenSettings,
}: {
  project: Project
  onDeleted: (projectId: string) => void
  /** Opens settings in place. The home screen omits it and the menu navigates
   * to the project page instead; the project page is already there, so it
   * passes a handler that opens its own modal. */
  onOpenSettings?: (tab: 'general' | 'sharing') => void
  /** Receives a chosen deck-export file to import as a new lecture (EXP-3).
   * Omitted for a project the viewer cannot add to. */
  onImport?: (file: File) => void
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Forwards the picked file, resets the input so the same file can be chosen
   * again, and closes the menu. */
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImport?.(file)
    e.target.value = ''
    setOpen(false)
  }

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
    if (onOpenSettings) {
      onOpenSettings(settingsTab)
      return
    }
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
      {onImport && (
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml"
          className="hidden"
          aria-label={t('lecture.import.intoProject', {
            project: projectTitle(project),
          })}
          onChange={onFileChange}
        />
      )}
      <button
        aria-label={t('project.options', { name: projectTitle(project) })}
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
          aria-label={t('project.options', { name: projectTitle(project) })}
          className="absolute end-0 z-10 mt-1 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            role="menuitem"
            onClick={() => openSettings('general')}
            className="block w-full px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50"
          >
            {t('common.settings')}
          </button>
          <button
            role="menuitem"
            onClick={() => openSettings('sharing')}
            className="block w-full px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50"
          >
            {t('deck.share')}
          </button>
          {onImport && (
            <button
              role="menuitem"
              onClick={() => fileInput.current?.click()}
              className="block w-full px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50"
            >
              {t('lecture.import.action')}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setConfirming(true)
            }}
            className="block w-full px-4 py-2 text-start text-sm text-red-600 hover:bg-red-50"
          >
            {t('common.delete')}
          </button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('project.delete.title')}
          message={t('project.delete.message', {
            name: projectTitle(project),
          })}
          confirmLabel={t('common.delete')}
          onConfirm={deleteProject}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
