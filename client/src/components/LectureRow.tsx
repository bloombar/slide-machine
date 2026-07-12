/**
 * A lecture (deck) in a list: title linking to the viewer, with
 * modification age and slide count as metadata. Shared by the home
 * screen, project pages, and public profiles. When `onDeleted` is
 * provided (owner lists), a kebab menu on the right offers Share —
 * which opens the lecture's Privacy & Sharing settings — and Delete,
 * which confirms in a dialog first.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MoreVertical } from 'lucide-react'
import type { Deck } from '@slide-machine/shared'
import { useTimeAgo } from '../hooks/useTimeAgo'
import { lectureTitle } from '../lib/lecture'
import { dispatchAction } from '../api/actions'
import ConfirmDialog from './ConfirmDialog'

function RowMenu({
  deck,
  onDeleted,
}: {
  deck: Deck
  onDeleted: (deckId: string) => void
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

  const share = () => {
    setOpen(false)
    navigate(`/d/${deck.permalinkSlug}`, {
      state: { settingsTab: 'sharing' },
    })
  }

  const deleteLecture = () => {
    dispatchAction('deck.delete', { deckId: deck.id })
      .then(() => {
        setConfirming(false)
        onDeleted(deck.id)
      })
      .catch(() => {
        // Quiet failure: the lecture simply stays
        setConfirming(false)
      })
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        aria-label={`Options for ${lectureTitle(deck)}`}
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
          aria-label={`Options for ${lectureTitle(deck)}`}
          className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            role="menuitem"
            onClick={share}
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
          title="Delete lecture?"
          message={`"${lectureTitle(deck)}" and all of its slides and seed material will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={deleteLecture}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

export default function LectureRow({
  deck,
  onDeleted,
}: {
  deck: Deck
  /** Owner lists only: enables the kebab menu (share / delete). */
  onDeleted?: (deckId: string) => void
}) {
  const age = useTimeAgo(deck.updatedAt)
  const count = deck.slideOrder.length

  return (
    <li className="flex items-center gap-1 rounded-md border border-slate-200 pr-2 hover:border-slate-300 hover:bg-slate-50">
      <Link
        to={`/d/${deck.permalinkSlug}`}
        className="min-w-0 flex-1 px-4 py-2"
      >
        <span className="block truncate">{lectureTitle(deck)}</span>
        <span className="block text-xs text-slate-500">
          {count} slide{count === 1 ? '' : 's'} · edited {age}
        </span>
      </Link>
      {onDeleted && <RowMenu deck={deck} onDeleted={onDeleted} />}
    </li>
  )
}
