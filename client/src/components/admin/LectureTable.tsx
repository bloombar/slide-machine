/**
 * Admin lecture listing shared by the admin user and project pages: a
 * table of lectures (viewer link, visibility badge, slide count,
 * last-edited date) with a per-row delete action, plus the visibility
 * badge itself for standalone use.
 */
import { Link } from 'react-router'
import type { Visibility } from '@slide-machine/shared'
import type { AdminDeckSummary } from '../../api/admin'

const asDate = (iso: string): string => new Date(iso).toLocaleDateString()

/** Colour-coded pill for a lecture's effective visibility. */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const isPublic = visibility === 'public'
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
        isPublic
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-slate-200 bg-slate-100 text-slate-600'
      }`}
    >
      {isPublic ? 'Public' : 'Private'}
    </span>
  )
}

/** A set of lectures as a table: title, visibility, slide count,
 * last-edited date, and a delete action. */
export default function LectureTable({
  decks,
  onDelete,
}: {
  decks: AdminDeckSummary[]
  onDelete: (deck: AdminDeckSummary) => void
}) {
  if (decks.length === 0) {
    return <p className="px-4 pb-3 text-sm text-slate-500">No lectures.</p>
  }
  return (
    <div className="px-4 pb-3">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              Lecture
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Visibility
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Slides
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Updated
            </th>
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {decks.map(deck => (
            <tr key={deck.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-3">
                <Link
                  to={`/d/${deck.permalinkSlug}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {deck.title.trim() || 'Untitled lecture'}
                </Link>
              </td>
              <td className="py-1.5 pr-3">
                <VisibilityBadge visibility={deck.visibility} />
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                {deck.slideCount}
              </td>
              <td className="py-1.5 pr-3 text-slate-500">
                {asDate(deck.updatedAt)}
              </td>
              <td className="py-1.5 text-right">
                <button
                  onClick={() => onDelete(deck)}
                  aria-label={`Delete lecture ${deck.title.trim() || 'Untitled lecture'}`}
                  className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
