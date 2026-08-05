/**
 * Admin lecture directory: every lecture on the platform in a table
 * (title, project, owner, effective visibility, slide count, timestamps),
 * paginated and sortable by every column. Rows link to the per-lecture
 * admin view, the project and owner cells to theirs. Soft-deleted lectures
 * are listed too, badged and muted, so they can be inspected or restored
 * (ADMIN-6).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  listAdminDecks,
  ADMIN_DECKS_PAGE_SIZE,
  ADMIN_DECKS_PAGE_SIZES,
  type AdminDecksResponse,
  type AdminDecksSort,
} from '../api/admin'
import SortHeader from '../components/admin/SortHeader'
import { formatAdminDate } from '../lib/date'
import DeletedBadge, {
  deletedTextClass,
} from '../components/admin/DeletedBadge'
import { VisibilityBadge } from '../components/admin/LectureTable'

export default function AdminDecksPage() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<AdminDecksSort>('updated:desc')
  const [limit, setLimit] = useState(ADMIN_DECKS_PAGE_SIZE)
  const [data, setData] = useState<AdminDecksResponse | null>(null)
  const [error, setError] = useState(false)

  // No reset on refetch: the error view unmounts every control that could
  // trigger one, so a stale error can never linger past a new response
  useEffect(() => {
    let cancelled = false
    listAdminDecks(page, sort, limit)
      .then(res => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [page, sort, limit])

  if (error) {
    return <p className="text-red-600">Could not load lectures.</p>
  }
  if (!data) {
    return <p className="text-slate-500">Loading…</p>
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))

  // Any sort change starts the listing over from the first page.
  const changeSort = (next: AdminDecksSort) => {
    setSort(next)
    setPage(1)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          Lectures{' '}
          <span className="text-base font-normal text-slate-500">
            ({data.total})
          </span>
        </h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Per page
          <select
            aria-label="Lectures per page"
            value={limit}
            onChange={e => {
              setLimit(Number(e.target.value))
              setPage(1)
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {ADMIN_DECKS_PAGE_SIZES.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <SortHeader
                label="Lecture"
                field="title"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Project"
                field="project"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Owner"
                field="owner"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Visibility"
                field="visibility"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Slides"
                field="slides"
                sort={sort}
                onSort={changeSort}
                align="right"
              />
              <SortHeader
                label="Created"
                field="created"
                sort={sort}
                onSort={changeSort}
                chronological
              />
              <SortHeader
                label="Updated"
                field="updated"
                sort={sort}
                onSort={changeSort}
                chronological
              />
            </tr>
          </thead>
          <tbody>
            {data.decks.map(deck => (
              <tr
                key={deck.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-2.5">
                  <Link
                    to={`/app/admin/decks/${deck.id}`}
                    className={`font-medium hover:underline ${
                      deck.deletedAt ? deletedTextClass : 'text-slate-900'
                    }`}
                  >
                    {deck.title.trim() || 'Untitled lecture'}
                  </Link>{' '}
                  <DeletedBadge deletedAt={deck.deletedAt} />
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    to={`/app/admin/projects/${deck.projectId}`}
                    className="text-slate-700 hover:underline"
                  >
                    {deck.projectTitle.trim() || 'Untitled project'}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {deck.ownerEmail ? (
                    <Link
                      to={`/app/admin/users/${deck.ownerId}`}
                      className="text-slate-700 hover:underline"
                    >
                      {deck.ownerEmail}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <VisibilityBadge visibility={deck.visibility} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {deck.slideCount}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {formatAdminDate(deck.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {formatAdminDate(deck.updatedAt)}
                </td>
              </tr>
            ))}
            {data.decks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-slate-500">
                  No lectures on this page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <button
          onClick={() => setPage(p => p - 1)}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {data.page} of {pageCount}
        </span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={page >= pageCount}
          className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
