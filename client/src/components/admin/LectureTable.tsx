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
import { useState } from 'react'
import { Link } from 'react-router'
import type { Visibility } from '@slide-machine/shared'
import type { AdminDeckSummary } from '../../api/admin'
import { formatAdminDate } from '../../lib/date'
import DeletedBadge, { deletedTextClass } from './DeletedBadge'
import SortHeader from './SortHeader'

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

/** The title a row shows, so sorting orders by what is on screen rather
 * than by the empty string an untitled lecture stores. */
const deckTitle = (deck: AdminDeckSummary): string =>
  deck.title.trim() || 'Untitled lecture'

/** A column this table can be ordered by, and the value it orders on. The
 * whole set is in hand here — the pages that use this table load all of a
 * user's or project's lectures at once — so sorting is local, unlike the
 * paginated directories, which sort server-side. */
const SORT_VALUES = {
  title: (deck: AdminDeckSummary) => deckTitle(deck).toLowerCase(),
  visibility: (deck: AdminDeckSummary) => deck.visibility,
  slides: (deck: AdminDeckSummary) => deck.slideCount,
  updated: (deck: AdminDeckSummary) => deck.updatedAt,
} as const

type LectureSortField = keyof typeof SORT_VALUES
type LectureSort = `${LectureSortField}:${'asc' | 'desc'}`

/** Orders a copy of the rows by one column. Numbers compare numerically;
 * everything else compares as text, which is right for titles, visibility
 * labels, and ISO timestamps alike. */
const sortDecks = (
  decks: AdminDeckSummary[],
  sort: LectureSort | null,
): AdminDeckSummary[] => {
  if (!sort) return decks
  const [field, dir] = sort.split(':') as [LectureSortField, 'asc' | 'desc']
  const order = dir === 'asc' ? 1 : -1
  const valueOf = SORT_VALUES[field]
  return [...decks].sort((a, b) => {
    const left = valueOf(a)
    const right = valueOf(b)
    const diff =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))
    return diff * order
  })
}

/** Spacing for this table's headers: tighter than the directories', since
 * it sits inside a detail page's card rather than filling the page. */
const HEADER_CLASS = 'py-1 pr-3 font-medium'

/** A set of lectures as a table: title, visibility, slide count,
 * last-edited date, and a delete action — or a restore action on the rows
 * that are already soft-deleted. Every column but the actions sorts, on
 * click; until one is clicked the rows stay in the order they arrived. */
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
  const [sort, setSort] = useState<LectureSort | null>(null)

  if (decks.length === 0) {
    return <p className="px-4 pb-3 text-sm text-slate-500">No lectures.</p>
  }
  return (
    <div className="px-4 pb-3">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr>
            <SortHeader
              label="Lecture"
              field="title"
              sort={sort}
              onSort={setSort}
              className={HEADER_CLASS}
            />
            <SortHeader
              label="Visibility"
              field="visibility"
              sort={sort}
              onSort={setSort}
              className={HEADER_CLASS}
            />
            <SortHeader
              label="Slides"
              field="slides"
              sort={sort}
              onSort={setSort}
              align="right"
              className={HEADER_CLASS}
            />
            <SortHeader
              label="Updated"
              field="updated"
              sort={sort}
              onSort={setSort}
              className={HEADER_CLASS}
              chronological
            />
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortDecks(decks, sort).map(deck => {
            const title = deckTitle(deck)
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
