/**
 * Admin lecture listing shared by the admin user and project pages: a
 * table of lectures (each linking to its own admin lecture page,
 * visibility badge, slide count, last-edited date) with a per-row
 * delete action, plus the visibility badge itself for standalone use.
 *
 * Soft-deleted lectures stay in the table, badged and muted; their row
 * action becomes Restore instead of Delete, since a tombstoned lecture is
 * recovered rather than deleted again (ADMIN-6).
 */
import { Link } from 'react-router'
import type { Visibility } from '@slide-machine/shared'
import type { AdminDeckSummary } from '../../api/admin'
import { formatAdminDate } from '../../lib/date'
import DeletedBadge, { deletedTextClass } from './DeletedBadge'

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
 * last-edited date, and a delete action — or a restore action on the rows
 * that are already soft-deleted. */
export default function LectureTable({
  decks,
  onDelete,
  onRestore,
}: {
  decks: AdminDeckSummary[]
  onDelete: (deck: AdminDeckSummary) => void
  /** Asked for on a soft-deleted row. Without it, deleted rows are listed
   * and badged but carry no action. */
  onRestore?: (deck: AdminDeckSummary) => void
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
          {decks.map(deck => {
            const title = deck.title.trim() || 'Untitled lecture'
            return (
              <tr key={deck.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-3">
                  <Link
                    to={`/app/admin/decks/${deck.id}`}
                    className={`font-medium hover:underline ${
                      deck.deletedAt ? deletedTextClass : 'text-slate-900'
                    }`}
                  >
                    {title}
                  </Link>{' '}
                  <DeletedBadge deletedAt={deck.deletedAt} />
                </td>
                <td className="py-1.5 pr-3">
                  <VisibilityBadge visibility={deck.visibility} />
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                  {deck.slideCount}
                </td>
                <td className="py-1.5 pr-3 text-slate-500">
                  {formatAdminDate(deck.updatedAt)}
                </td>
                <td className="py-1.5 text-right">
                  {deck.deletedAt ? (
                    onRestore && (
                      <button
                        onClick={() => onRestore(deck)}
                        aria-label={`Restore lecture ${title}`}
                        className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        Restore
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => onDelete(deck)}
                      aria-label={`Delete lecture ${title}`}
                      className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
