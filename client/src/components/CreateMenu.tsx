/**
 * The "+" button beside a heading: the home screen's welcome, and a
 * project page's "Lectures". It opens a small menu of the ways to start
 * something — a new project, a new lecture, or a lecture imported from an
 * exported file (EXP-3). A project page is already inside a project, so it
 * omits New project by leaving out that handler.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Import, Plus, Presentation } from 'lucide-react'

interface Props {
  /** Omitted where a new project makes no sense, which drops the item. */
  onNewProject?: () => void
  onNewLecture: () => void
  /** Receives a chosen deck-export file to import as a new lecture. */
  onImportLecture: (file: File) => void
}

export default function CreateMenu({
  onNewProject,
  onNewLecture,
  onImportLecture,
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Forwards the picked file, resets the input so the same file can be
   * chosen again, and closes the menu. */
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImportLecture(file)
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

  /** Runs a menu item's action and closes the menu behind it. */
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  const item =
    'flex w-full items-center gap-2 px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50'

  return (
    <div ref={menuRef} className="relative shrink-0">
      <input
        ref={fileInput}
        type="file"
        accept=".yaml,.yml"
        className="hidden"
        aria-label={t('lecture.import.label')}
        onChange={onFileChange}
      />
      <button
        aria-label={t('home.createNew')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
      >
        <Plus className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('home.createNew')}
          className="absolute end-0 z-10 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {onNewProject && (
            <button
              role="menuitem"
              onClick={choose(onNewProject)}
              className={item}
            >
              <FolderPlus className="h-4 w-4 shrink-0" aria-hidden />
              {t('project.new.action')}
            </button>
          )}
          <button
            role="menuitem"
            onClick={choose(onNewLecture)}
            className={item}
          >
            <Presentation className="h-4 w-4 shrink-0" aria-hidden />
            {t('lecture.new.action')}
          </button>
          <button
            role="menuitem"
            onClick={() => fileInput.current?.click()}
            className={item}
          >
            <Import className="h-4 w-4 shrink-0" aria-hidden />
            {t('lecture.import.label')}
          </button>
        </div>
      )}
    </div>
  )
}
