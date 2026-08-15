/**
 * The "+" button beside a heading: the home screen's welcome, and a
 * project page's "Lectures". It opens a small menu of the ways to start
 * something — a new project, a new lecture, or one brought in from elsewhere.
 * A project page is already inside a project, so it omits New project by
 * leaving out that handler.
 *
 * Importing is ONE entry, not one per source. A Google Slides deck (EXP-5)
 * and a `.yaml` file this app exported (EXP-3) are the same errand, and
 * splitting them made the instructor decide which category their material
 * fell into before they could begin. The panel that opens asks instead.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Plus, Presentation, Upload } from 'lucide-react'

interface Props {
  /** Omitted where a new project makes no sense, which drops the item. */
  onNewProject?: () => void
  onNewLecture: () => void
  /** Opens the import panel, which asks where the lecture is coming from. */
  onImportLecture: () => void
}

export default function CreateMenu({
  onNewProject,
  onNewLecture,
  onImportLecture,
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
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

  /** Runs a menu item's action and closes the menu behind it. */
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  const item =
    'flex w-full items-center gap-2 px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50'

  return (
    <div ref={menuRef} className="relative shrink-0">
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
            onClick={choose(onImportLecture)}
            className={item}
          >
            <Upload className="h-4 w-4 shrink-0" aria-hidden />
            {t('lecture.import.label')}
          </button>
        </div>
      )}
    </div>
  )
}
