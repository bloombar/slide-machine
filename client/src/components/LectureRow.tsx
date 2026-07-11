/**
 * A lecture (deck) in a list: title linking to the viewer, with
 * modification age and slide count as metadata. Shared by the home
 * screen and project pages.
 */
import { Link } from 'react-router'
import type { Deck } from '@slide-machine/shared'
import { useTimeAgo } from '../hooks/useTimeAgo'

export default function LectureRow({ deck }: { deck: Deck }) {
  const age = useTimeAgo(deck.updatedAt)
  const count = deck.slideOrder.length

  return (
    <li>
      <Link
        to={`/d/${deck.permalinkSlug}`}
        className="block rounded-md border border-slate-200 px-4 py-2 hover:border-slate-300 hover:bg-slate-50"
      >
        <span className="block">{deck.title}</span>
        <span className="block text-xs text-slate-500">
          {count} slide{count === 1 ? '' : 's'} · edited {age}
        </span>
      </Link>
    </li>
  )
}
