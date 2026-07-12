/**
 * Per-slide kebab superimposed over the slide's top-right corner
 * (replacing the old bare delete icon): a context menu with Change
 * layout (EDIT-3, opens the layout picker) and Delete slide (immediate,
 * no confirmation). Sits above the SlideNavZones hotspots (z-10, see
 * the z-index tiers) so clicks act on the menu instead of navigating.
 */
import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'

interface Props {
  /** 1-based slide number, for accessible names. */
  number: number
  onChangeLayout: () => void
  onDelete: () => void
}

export default function SlideMenu({ number, onChangeLayout, onDelete }: Props) {
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

  const pick = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div ref={menuRef} className="absolute top-3 right-3 z-10">
      <button
        aria-label={`Options for slide ${number}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="rounded-full bg-black/30 p-2 text-white hover:bg-black/50"
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Options for slide ${number}`}
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            role="menuitem"
            onClick={pick(onChangeLayout)}
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Change layout
          </button>
          <button
            role="menuitem"
            onClick={pick(onDelete)}
            className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Delete slide
          </button>
        </div>
      )}
    </div>
  )
}
